"""Regression coverage for frozen OCR subprocess routing."""
import sys
import types
import unittest
from unittest.mock import Mock, patch

import launcher


class LauncherTests(unittest.TestCase):
    def test_ocr_subprocess_does_not_start_another_web_server(self):
        worker = types.ModuleType('server.trade_ocr_worker')
        worker.main = Mock()
        with patch.object(sys, 'argv', ['ContainerPlanner.exe', r'C:\bundle\server\trade_ocr_worker.py']), \
             patch.dict(sys.modules, {'server.trade_ocr_worker': worker}), \
             patch.object(launcher, 'main') as web_main, \
             patch.object(launcher.multiprocessing, 'freeze_support'):
            launcher.dispatch()
        worker.main.assert_called_once_with()
        web_main.assert_not_called()

    def test_normal_launch_starts_web_server(self):
        with patch.object(sys, 'argv', ['ContainerPlanner.exe']), \
             patch.object(launcher, 'main') as web_main, \
             patch.object(launcher.multiprocessing, 'freeze_support'):
            launcher.dispatch()
        web_main.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
