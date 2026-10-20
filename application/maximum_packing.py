"""Quantity-free loading: preserve fixed cargo, search, then refill actual gaps.

Volume bounds are search inventory only. They are never treated as a feasible
maximum, and exhausting a search budget never silently reduces the inventory.
"""
import time
from collections import Counter

from packer_pro import ContainerPacker, MM, original_orientation_order, to_mm
from planner_core import rows_to_boxes_ex


def pack_maximum(container, rows, threshold=100, mode='standard', budget=10,
                 bottom_metric='none', max_pieces=20000):
    started = time.monotonic()
    seconds = min(float(budget), 4.0) if mode == 'standard' else float(budget)
    deadline = started + seconds
    flags = [int(r.get('n', 0) or 0) <= 0 for r in rows]
    fixed_volume = sum(to_mm(r['l']) * to_mm(r['w']) * to_mm(r['h']) * int(r['n'])
                       for r, flag in zip(rows, flags) if not flag)
    fixed_pieces = sum(int(r['n']) for r, flag in zip(rows, flags) if not flag)
    free_volume = max(0, container[0] * container[1] * container[2] - fixed_volume)
    # Each filler may use all remaining volume. Do not divide it among types:
    # an unplaceable type must not reserve space from another usable type.
    inventory = []
    for row, flag in zip(rows, flags):
        volume = to_mm(row['l']) * to_mm(row['w']) * to_mm(row['h'])
        count = min(max_pieces - fixed_pieces, free_volume // volume) if flag else int(row['n'])
        inventory.append({**row, 'n': max(1, count)})
    boxes, no_flip, priority, descriptions = rows_to_boxes_ex(inventory)
    packer = ContainerPacker(container, boxes, threshold, no_flip=no_flip,
                             priority=priority, descriptions=descriptions,
                             bottom_metric=bottom_metric)
    evaluations = 0
    best = None
    best_key = None

    def remember():
        nonlocal best, best_key, evaluations
        evaluations += 1
        counts = Counter(info['input_order'] for info in packer.box_colors)
        fixed_loaded = sum(min(counts[i], int(r['n']))
                           for i, (r, flag) in enumerate(zip(rows, flags)) if not flag)
        volume = sum(l*w*h for _, _, _, l, w, h in packer.packing_plan)
        key = (fixed_loaded, volume, len(packer.packing_plan))
        if len(packer.packing_plan) <= max_pieces and (best_key is None or key > best_key):
            best_key = key
            best = (list(packer.packing_plan), [dict(i) for i in packer.box_colors])

    # Fixed-first candidate is essential: maximizing volume alone can discard a
    # required large box in favour of unlimited small filler.
    fixed_order, orientations = packer._policy_priority() if bottom_metric == 'manual' else packer._policy_original()
    fixed_order = [box for box in fixed_order if not flags[box[6]]]
    packer._run_policy(fixed_order, orientations)
    remember()
    fixed_seed = best

    # Bulk blocks avoid thousands of individual placement decisions. Include the
    # joint layout to allow mixed orientations and better fixed-cargo placement.
    if bottom_metric != 'manual':
        for options in ({}, {'general': True}):
            if time.monotonic() >= deadline:
                break
            candidate, _ = packer._block_candidate(**options)
            if candidate is not None:
                remember()

    bulk_seed = best
    stop = 'no_candidate'
    # Preserve the better bulk result while also testing refill around fixed
    # cargo. All placements use the shared collision and support checks.
    for seed in (bulk_seed, fixed_seed):
        if seed is None or time.monotonic() >= deadline:
            break
        packer._restore_plan(*seed)
        stopped = _refill(packer, flags, rows, deadline, max_pieces)
        remember()
        if seed is bulk_seed:
            stop = stopped
    packer._restore_plan(*best)
    # A bounded beam search can improve arrangements, but has no all-items-fit
    # termination target for unlimited cargo. Keep it inside the chosen budget.
    if mode == 'enhanced' and bottom_metric != 'manual' and time.monotonic() < deadline:
        remaining = deadline - time.monotonic()
        candidate, _ = packer._block_candidate(deadline=time.time() + remaining)
        if candidate is not None:
            remember()
        packer._restore_plan(*best)
        stop = 'time_limit' if time.monotonic() >= deadline else stop
    counts = Counter(info['input_order'] for info in packer.box_colors)
    # Export actual filler quantities, rather than fictitious requested caps.
    packer.boxes = [(l,w,h,counts[io] if flags[io] else n,wt,t,io)
                    for l,w,h,n,wt,t,io in packer.boxes]
    packer.total_units = sum(box[3] for box in packer.boxes)
    used = sum(l*w*h for _,_,_,l,w,h in packer.packing_plan)
    fits = all(flags[i] or counts[i] == int(r['n']) for i, r in enumerate(rows))
    if len(packer.packing_plan) >= max_pieces:
        stop = 'piece_limit'
    elif time.monotonic() >= deadline:
        stop = 'time_limit'
    proven = fits and used == packer.container_volume
    stats = dict(placed=len(packer.packing_plan), total=fixed_pieces + sum(counts[i] for i,f in enumerate(flags) if f),
                 utilization=used / packer.container_volume, seconds=round(time.monotonic()-started, 2),
                 evaluations=evaluations, optimal_full=proven, max_search_stop=stop,
                 fixed_complete=fits)
    message = '已保留定量货物并搜索剩余空间；当前为已找到的可行装载量。'
    if stop == 'piece_limit':
        message += '已达到单次件数限制，可提高限制后继续搜索。'
    elif stop == 'time_limit':
        message += '已达到本次搜索时间上限。'
    elif not proven:
        message += '候选空隙已检查，仍可能通过重新排布装入更多。'
    return packer, fits, message, stats, flags


def _refill(packer, flags, rows, deadline, max_pieces):
    kinds = [box for box in packer.boxes if flags[box[6]]]
    kinds.sort(key=lambda b: (packer._sink_key(b) if packer.bottom_metric == 'manual' else b[0]*b[1]*b[2]), reverse=True)
    orients = {b[6]: packer._allowed(b[6], original_orientation_order(*b[:3])) for b in kinds}
    while len(packer.packing_plan) < max_pieces:
        added = False
        for l,w,h,n,weight,t,io in kinds:
            for x,y,z in sorted(packer.points, key=lambda p: (p[2],p[1],p[0])):
                if time.monotonic() >= deadline:
                    return 'time_limit'
                placement = next(((x,y,z,a,b,c) for a,b,c in orients[io]
                                  if packer.can_place(x,y,z,a,b,c,weight)), None)
                if placement is None:
                    continue
                packer._place(*placement)
                packer.box_colors.append(dict(number=len(packer.packing_plan), type=t,
                    type_count=io+1, weight=weight, input_order=io,
                    original_dimensions=(l/MM,w/MM,h/MM), desc=rows[io].get('desc','')))
                added = True
                break
            if added:
                break
        if not added:
            return 'no_candidate'
    return 'piece_limit'
