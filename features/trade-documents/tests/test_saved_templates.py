"""Template persistence regression using an isolated temporary store."""
import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'application'))
from server import main


class SavedTemplatesTest(unittest.TestCase):
    def test_section_and_overall_persistence(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main, 'TEMPLATE_FILE', Path(directory) / 'templates.json'):
            for kind, values in [('trade_sections', {'group': '运输', 'fields': {'port': 'Example'}}),
                                 ('trade_records', {'fields': {'invoice_no': 'TEST'}, 'products': [], 'customFields': []})]:
                saved = asyncio.run(main.save_template(kind, 'test', main.SavedTemplate(id='test', name='测试', values=values)))
                self.assertEqual(saved['values'], values)
                self.assertEqual(asyncio.run(main.get_templates())[kind][0]['name'], '测试')
                asyncio.run(main.delete_template(kind, 'test'))
                self.assertEqual(asyncio.run(main.get_templates())[kind], [])
            self.assertEqual(asyncio.run(main.get_templates())['products'], [])


if __name__ == '__main__':
    unittest.main()
