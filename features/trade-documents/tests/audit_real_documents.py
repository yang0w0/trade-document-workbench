"""Read a user-specified corpus in place through the HTTP upload API.

The report contains file hashes and field names, never extracted business values.
Run: python audit_real_documents.py FOLDER --url http://127.0.0.1:8000 --report REPORT
"""
import argparse
import hashlib
import json
from pathlib import Path
import time
import httpx


def required_fields(path):
    if '提箱' in path.name:
        return {'bill_of_lading', 'container_count', 'vessel_name', 'destination_port', 'shipment_date'}
    if path.suffix.lower() == '.doc':
        return {'contract_no', 'seller_name', 'buyer_name', 'bill_of_lading', 'quantity', 'gross_weight', 'net_weight', 'hs_code', 'item_description', 'unit_price', 'amount', 'currency'}
    if path.suffix.lower() == '.docx':
        return {'document_no', 'batch_no', 'production_date', 'item_description', 'item_specification', 'sample_quantity', 'quantity'}
    if path.suffix.lower() == '.xls':
        return {'document_no', 'buyer_name', 'seller_name', 'quantity_per_container', 'package_count', 'unit_price', 'amount', 'currency', 'item_description'}
    if '申报要素' in path.name:
        return {'brand', 'brand_type', 'export_preference', 'processing_method', 'composition', 'item_specification'}
    if path.suffix.lower() == '.xlsx':
        return {'contract_no', 'document_no', 'item_description', 'hs_code', 'quantity', 'gross_weight', 'net_weight', 'amount', 'unit_price'}
    if '手册' in path.name:
        return {'contract_no', 'hs_code', 'item_description', 'item_specification', 'quantity', 'unit_price', 'amount', 'currency'}
    return {'contract_no', 'seller_name', 'item_description', 'hs_code', 'quantity', 'declared_weight', 'amount', 'currency'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--url', default='http://127.0.0.1:8000')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    results = []
    with httpx.Client(timeout=180, trust_env=False) as client:
        for path in sorted(args.folder.rglob('*')):
            if not path.is_file():
                continue
            content = path.read_bytes()
            digest = hashlib.sha256(content).hexdigest()
            started = time.monotonic()
            response = client.post(args.url.rstrip('/') + '/api/documents/extract', files={'file': (path.name, content)})
            data = response.json()
            fields = data.get('fields', {})
            missing = sorted(required_fields(path) - {k for k, v in fields.items() if v})
            evidence_ok = all(c.get('evidence') and c.get('location') and c.get('rawText') for values in fields.values() for c in values)
            unchanged = hashlib.sha256(path.read_bytes()).hexdigest() == digest
            passed = response.status_code == 200 and not missing and evidence_ok and unchanged
            result = {'file': str(path.relative_to(args.folder)), 'sha256': digest,
                      'status': response.status_code, 'passed': passed, 'missing': missing,
                      'fieldCount': len(fields), 'fields': sorted(fields),
                      'evidenceVerified': evidence_ok, 'sourceUnchanged': unchanged,
                      'method': data.get('document', {}).get('method'),
                      'seconds': round(time.monotonic() - started, 2)}
            results.append(result)
            print(('PASS' if passed else 'FAIL'), path.name, len(fields), 'fields', 'missing=' + ','.join(missing), flush=True)
    report = {'files': len(results), 'passed': sum(r['passed'] for r in results), 'results': results}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if not results or report['passed'] != report['files']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
