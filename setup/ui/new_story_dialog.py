from __future__ import annotations

from pathlib import Path
import re

from PySide6.QtCore import QRegularExpression
from PySide6.QtGui import QRegularExpressionValidator
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QLineEdit,
    QVBoxLayout,
    QWidget,
)


VALID_ID_RE = re.compile(r'^[a-z0-9][a-z0-9-]*$')
ALLOWED_CHAR_RE = re.compile(r'[^a-z0-9-]')


class NewStoryDialog(QDialog):
    """Janela única para criar nova história com ID validado e título."""

    def __init__(self, app_root: Path, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._app_root = app_root

        self.setWindowTitle('Nova História')
        self.resize(480, 190)

        layout = QVBoxLayout(self)
        form = QFormLayout()
        form.setSpacing(10)

        self.id_edit = QLineEdit()
        self.id_edit.setPlaceholderText('ex.: minha-aventura')
        self.id_edit.setValidator(
            QRegularExpressionValidator(QRegularExpression(r'^[a-z0-9-]*$'), self.id_edit)
        )
        self.id_edit.textChanged.connect(self._on_id_changed)

        self.title_edit = QLineEdit()
        self.title_edit.setPlaceholderText('ex.: Minha Aventura na Cidade')
        self.title_edit.textChanged.connect(self._update_ok_state)

        form.addRow('Identificador da pasta:', self.id_edit)
        form.addRow('Título da história:', self.title_edit)
        layout.addLayout(form)

        self.hint_label = QLabel('Use apenas letras minúsculas, números e hífen (-) no identificador.')
        self.hint_label.setStyleSheet('font-size: 11px; color: #94a3b8;')
        layout.addWidget(self.hint_label)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText('Criar História')
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText('Cancelar')
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        self._ok_btn = buttons.button(QDialogButtonBox.StandardButton.Ok)
        layout.addWidget(buttons)

        self._update_ok_state()

    def _on_id_changed(self, text: str) -> None:
        cleaned = ALLOWED_CHAR_RE.sub('', text.lower())
        if cleaned != text:
            pos = self.id_edit.cursorPosition()
            self.id_edit.blockSignals(True)
            self.id_edit.setText(cleaned)
            self.id_edit.setCursorPosition(min(pos, len(cleaned)))
            self.id_edit.blockSignals(False)
        self._update_ok_state()

    def _update_ok_state(self) -> None:
        sid = self.story_id()
        valid_id = bool(VALID_ID_RE.match(sid)) and sid != '_template'
        valid_title = bool(self.story_title())
        self._ok_btn.setEnabled(valid_id and valid_title)

    def story_id(self) -> str:
        return self.id_edit.text().strip().lower()

    def story_title(self) -> str:
        return self.title_edit.text().strip()
