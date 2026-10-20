import sys, time
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r'D:/bag/packing-eval/ContainerPlanner-网页版/源码')
from packer_pro import MM
from planner_core import rows_to_boxes_ex, run_packing

ROWS = [
    {'l':0.49,'w':0.4,'h':0.09,'n':44,'wt':18,'type':'纸箱','no_flip':False,'prio':0,'desc':'法兰盘配件'},
    {'l':0.35,'w':0.28,'h':0.35,'n':795,'wt':12,'type':'纸箱','no_flip':False,'prio':0,'desc':'标准螺丝组'},
]
C = (5800,2350,2350)
t0=time.time()
boxes,nf,pr,dc = rows_to_boxes_ex(ROWS)
packer,fits,msg,stats = run_packing(C, boxes, 100, 'enhanced', 120,
    no_flip=nf, priority=pr, bottom_metric='none', descriptions=dc)
used = sum(l*w*h for _,_,_,l,w,h in packer.packing_plan)
print('增强版: 已装 %d/%d  利用率 %.1f%%  评估方案数 %d  用时 %.1fs' % (
    len(packer.packing_plan), stats['total'], used/packer.container_volume*100,
    stats['evaluations'], time.time()-t0))
