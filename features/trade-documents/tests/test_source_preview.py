"""Synthetic API regressions; real business documents are tested in place separately."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'application'))
import pymupdf
from fastapi import FastAPI
from fastapi.testclient import TestClient
from server.trade_documents import router


class SourcePreviewTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        with pymupdf.open() as pdf:
            for value in ['Invoice no: FIRST', 'Invoice no: SECOND']:
                pdf.new_page().insert_text((72, 72), value)
            self.content = pdf.tobytes()

    def test_pdf_original_bytes_page_focus_and_render(self):
        response = self.client.post('/api/documents/source-sessions', files={'file': ('invoice.pdf', self.content)})
        self.assertEqual(response.status_code, 200, response.text)
        session = response.json()['sessionId']
        base = f'/api/documents/source-sessions/{session}'
        data = self.client.post(base + '/focus', json={'location': '第 2 页第 1 行', 'text': 'SECOND'}).json()
        self.assertEqual(data['focusPage'], 2)
        self.assertEqual(data['pageCount'], 2)
        self.assertTrue(data['matches'])
        self.assertEqual(data['matches'][0]['page'], 2)
        self.assertFalse(data['capabilities']['edit'])
        self.assertEqual(self.client.get(base + '/original').content, self.content)
        self.assertEqual(self.client.get(base + '/preview.pdf').content, self.content)
        self.assertTrue(self.client.get(base + '/pages/2.png').content.startswith(b'\x89PNG'))
        self.assertEqual(self.client.get(base + '/pages/3.png').status_code, 404)

    def test_invalid_documents_and_unknown_sessions_fail_explicitly(self):
        self.assertEqual(self.client.post('/api/documents/source-sessions', files={'file': ('bad.pdf', b'broken')}).status_code, 400)
        self.assertEqual(self.client.post('/api/documents/source-sessions', files={'file': ('bad.html', b'<script/>')}).status_code, 400)
        self.assertEqual(self.client.get('/api/documents/source-sessions/missing').status_code, 404)

    def test_scanned_pdf_uses_existing_ocr_coordinates(self):
        response = self.client.post('/api/documents/source-sessions', files={'file': ('scan.pdf', self.content)})
        base = '/api/documents/source-sessions/' + response.json()['sessionId']
        data = self.client.post(base + '/focus', json={'location': '第 2 页 OCR，区域 40,60,240,60,240,100,40,100第 1 列',
                                             'text': 'not in text layer'}).json()
        self.assertTrue(data['locationResolved'])
        self.assertEqual(data['matches'][0]['rect'], [20, 30, 120, 50])

    def test_normalized_value_can_locate_spaced_rendered_text(self):
        with pymupdf.open() as pdf:
            pdf.new_page().insert_text((72, 72), '5640 CTNS x 24 CANS')
            content = pdf.tobytes()
        response = self.client.post('/api/documents/source-sessions', files={'file': ('spaced.pdf', content)})
        base = '/api/documents/source-sessions/' + response.json()['sessionId']
        data = self.client.post(base + '/focus', json={'location': '第 1 页', 'text': '5640CTNSx24CANS'}).json()
        self.assertTrue(data['locationResolved'])


if __name__ == '__main__':
    unittest.main()
