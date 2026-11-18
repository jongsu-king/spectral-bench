"""Exercise actual file writes and recovery without opening native dialogs."""

import base64
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import json

import desktop


class FakeWindow:
    def __init__(self, selection):
        self.selection = selection

    def create_file_dialog(self, *args, **kwargs):
        return self.selection


class FileTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.dialogs = desktop.FileDialogs(self.directory / 'profile' / 'recovery.json')
        self.webview = patch.dict('sys.modules', {'webview': SimpleNamespace(FileDialog=SimpleNamespace(SAVE='save'))})
        self.webview.start()

    def tearDown(self):
        self.webview.stop()
        self.temporary.cleanup()

    def envelope(self):
        return json.dumps({'format': 'spectral-bench-recovery', 'version': 1, 'savedAt': 1234,
            'session': {'format': 'spectral-bench', 'version': 1, 'instrument': 'uv', 'instruments': {'uv': {'seed': 632}}}})

    def test_atomic_failure_preserves_previous_file_and_cleans_temporary(self):
        path = self.directory / 'existing.csv'
        path.write_bytes(b'previous')
        with patch.object(desktop.os, 'replace', side_effect=OSError('Disk full')):
            with self.assertRaises(OSError):
                desktop.save_text(path, 'replacement')
        self.assertEqual(path.read_bytes(), b'previous')
        self.assertEqual(list(self.directory.iterdir()), [path])

    def test_figure_bytes_are_decoded_and_saved(self):
        png = b'\x89PNG\r\n\x1a\nexample'
        path = self.directory / 'figure'
        self.dialogs._window = FakeWindow([str(path)])
        reply = self.dialogs.save_figure('plot.png', base64.b64encode(png).decode(), 'base64')
        self.assertEqual(reply, {'name': 'figure.png'})
        self.assertEqual(path.with_suffix('.png').read_bytes(), png)
        self.dialogs._window = FakeWindow([str(path)])
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>ΔA · µm</text></svg>'
        self.assertEqual(self.dialogs.save_figure('plot.svg', svg), {'name': 'figure.svg'})
        self.assertEqual(path.with_suffix('.svg').read_text(encoding='utf-8'), svg)

    def test_figure_rejects_invalid_encoding_and_honors_cancel(self):
        self.assertIn('error', self.dialogs.save_figure('plot.png', 'not base64', 'base64'))
        self.assertIn('error', self.dialogs.save_figure('plot.png', 'Zm9v', 'base64'))
        self.assertIn('error', self.dialogs.save_figure('plot.gif', 'data'))
        self.assertIn('error', self.dialogs.save_figure('plot.svg', 'not svg'))
        self.dialogs._window = FakeWindow(None)
        self.assertEqual(self.dialogs.save_figure('plot.svg', '<svg/>'), {'cancelled': True})

    def test_recovery_round_trip_and_explicit_discard(self):
        self.assertEqual(self.dialogs.load_recovery(), {'content': None})
        self.assertEqual(self.dialogs.save_recovery(self.envelope()), {'saved': True})
        self.assertEqual(self.dialogs.load_recovery(), {'content': self.envelope()})
        self.assertEqual(self.dialogs.clear_recovery(), {'cleared': True})
        self.assertEqual(self.dialogs.load_recovery(), {'content': None})

    def test_invalid_recovery_does_not_replace_existing_copy(self):
        self.dialogs.save_recovery(self.envelope())
        for bad in ['broken', '{}', json.dumps({'format': 'other'})]:
            self.assertIn('error', self.dialogs.save_recovery(bad))
            self.assertEqual(self.dialogs.load_recovery(), {'content': self.envelope()})
        self.dialogs._recovery_path.write_text('broken')
        self.assertIn('error', self.dialogs.load_recovery())
        self.assertEqual(self.dialogs._recovery_path.read_text(), 'broken')

    def test_smoke_mode_does_not_touch_profile(self):
        disabled = desktop.FileDialogs(self.directory / 'not-written.json', recovery_enabled=False)
        self.assertEqual(disabled.save_recovery(self.envelope()), {'saved': True})
        self.assertEqual(disabled.load_recovery(), {'content': None})
        self.assertFalse(disabled._recovery_path.exists())


if __name__ == '__main__':
    unittest.main()
