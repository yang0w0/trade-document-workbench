"""Read real documents in place; report hashes and counts, never business values."""
import argparse
import hashlib
import json
from pathlib import Path
import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:8017')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    results = []
    with httpx.Client(base_url=args.url, timeout=180, trust_env=False) as client:
        for path in sorted(args.folder.rglob('*')):
            if path.suffix.lower() not in {'.docx', '.doc', '.pdf'}:
                continue
            content = path.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            extracted = client.post('/api/documents/extract', files={'file': (path.name, content)})
            extracted.raise_for_status()
            response = client.post('/api/documents/source-sessions', files={'file': (path.name, content)})
            response.raise_for_status()
            session = response.json()['sessionId']
            base = f'/api/documents/source-sessions/{session}'
            metadata = client.get(base).json()
            candidates = [item for values in extracted.json()['fields'].values() for item in values]
            resolved = 0
            unresolved = []
            for candidate in candidates:
                focused = client.post(base + '/focus', json={'location': candidate['location'], 'text': candidate['value']})
                focused.raise_for_status()
                if focused.json()['locationResolved']:
                    resolved += 1
                else:
                    unresolved.append({'field': candidate['fieldId'], 'location': candidate['location']})
            pages_ok = all(client.get(base + f'/pages/{number}.png').content.startswith(b'\x89PNG')
                           for number in range(1, metadata['pageCount'] + 1))
            original_ok = client.get(base + '/original').content == content
            pdf_ok = path.suffix.lower() != '.pdf' or client.get(base + '/preview.pdf').content == content
            unchanged = hashlib.sha256(path.read_bytes()).hexdigest() == digest
            result = {'file': path.name, 'sha256': digest,
                      'pages': metadata['pageCount'], 'candidates': len(candidates), 'resolved': resolved,
                      'unresolved': unresolved, 'pagesRendered': pages_ok, 'originalDownloadIdentical': original_ok,
                      'pdfPreviewIdentical': pdf_ok, 'sourceUnchanged': unchanged,
                      'passed': bool(candidates) and resolved == len(candidates) and pages_ok and original_ok and pdf_ok and unchanged}
            results.append(result)
            print(path.name, 'pages=', metadata['pageCount'], 'located=', resolved, '/', len(candidates), flush=True)
    args.report.write_text(json.dumps({'results': results, 'passed': all(r['passed'] for r in results)},
                                     ensure_ascii=False, indent=2), encoding='utf-8')
    if not results or not all(r['passed'] for r in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
