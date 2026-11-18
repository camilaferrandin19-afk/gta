from __future__ import annotations

import html
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtGui import QMouseEvent
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGridLayout,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

from ..core.models import Character, StoryPackage
from .widgets import AssetPreviewWidget


GRID_COLUMNS = 4


class _CharacterGridCard(QFrame):
    """Card clicável de personagem com prioridade: sprite_cutscene -> sprite_front -> nome."""

    def __init__(
        self,
        character: Character,
        image_path: Path | None,
        on_click: Callable[[str], None],
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.char_id = character.id
        self._on_click = on_click
        self.setFixedSize(104, 104)
        self.setCursor(Qt.CursorShape.PointingHandCursor)

        display_name = character.name or character.id
        self.setToolTip(f'{display_name} ({character.id})')

        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        if image_path and image_path.is_file():
            preview = AssetPreviewWidget(80, parent=self)
            preview.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            preview.load_file(image_path)
            layout.addWidget(preview)
        else:
            fallback = QLabel(self)
            fallback.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            fallback.setAlignment(Qt.AlignmentFlag.AlignCenter)
            fallback.setWordWrap(True)
            fallback.setFixedSize(84, 84)
            fallback.setStyleSheet(
                'color: #e2e8f0; font-weight: 700; font-size: 12px; background: transparent; border: none;'
            )
            short_name = display_name if len(display_name) <= 18 else f'{display_name[:15]}...'
            fallback.setText(short_name)
            layout.addWidget(fallback)

        self.set_selected(False)

    def set_selected(self, selected: bool) -> None:
        if selected:
            self.setStyleSheet(
                'QFrame { background: #1e2638; border: 2px solid #f59e0b; border-radius: 8px; }'
            )
        else:
            self.setStyleSheet(
                'QFrame { background: #141720; border: 1px solid #2b3245; border-radius: 8px; }'
                'QFrame:hover { border: 1px solid #64748b; background: #191e2b; }'
            )

    def mousePressEvent(self, event: QMouseEvent) -> None:
        if event.button() == Qt.MouseButton.LeftButton:
            self._on_click(self.char_id)
        super().mousePressEvent(event)


class CharacterPickerDialog(QDialog):
    """Diálogo com grade visual rolável para escolher um personagem."""

    def __init__(
        self,
        app_root: Path,
        pkg: StoryPackage,
        current_char_id: str = '',
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._pkg = pkg
        self._story_dir = app_root / 'story' / pkg.id
        self.selected_char_id = (current_char_id or '').strip()
        self._cards: dict[str, _CharacterGridCard] = {}

        self.setWindowTitle('Escolher Personagem')
        self.resize(520, 460)

        layout = QVBoxLayout(self)
        hint = QLabel('Clique no personagem para selecioná-lo:')
        layout.addWidget(hint)

        scroll = QScrollArea(self)
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)

        grid_container = QWidget()
        grid = QGridLayout(grid_container)
        grid.setSpacing(10)
        grid.setContentsMargins(10, 10, 10, 10)
        grid.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)

        ordered_ids = list(pkg.characters_order) + [
            cid for cid in pkg.characters if cid not in pkg.characters_order
        ]

        idx = 0
        for cid in ordered_ids:
            char = pkg.characters.get(cid)
            if not char:
                continue
            img_path = self._resolve_preview_image(char)
            card = _CharacterGridCard(char, img_path, self._on_card_clicked, parent=grid_container)
            grid.addWidget(card, idx // GRID_COLUMNS, idx % GRID_COLUMNS)
            self._cards[cid] = card
            idx += 1

        scroll.setWidget(grid_container)
        layout.addWidget(scroll, 1)

        self.selection_label = QLabel()
        self.selection_label.setTextFormat(Qt.TextFormat.RichText)
        self.selection_label.setWordWrap(True)
        self.selection_label.setStyleSheet(
            'padding: 8px 10px; background: #141720; border: 1px solid #2b3245; '
            'border-radius: 6px; color: #f59e0b;'
        )
        layout.addWidget(self.selection_label)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText('OK')
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText('Cancelar')
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        self._ok_btn = buttons.button(QDialogButtonBox.StandardButton.Ok)
        layout.addWidget(buttons)

        self._update_selection()

    def _resolve_preview_image(self, char: Character) -> Path | None:
        for rel in (char.sprite_cutscene, char.sprite_front):
            if rel:
                candidate = self._story_dir / rel
                if candidate.is_file():
                    return candidate
        return None

    def selected_character_name(self) -> str:
        char = self._pkg.characters.get(self.selected_char_id)
        if not char:
            return ''
        return char.name or char.id

    def _on_card_clicked(self, char_id: str) -> None:
        self.selected_char_id = char_id
        self._update_selection()

    def _update_selection(self) -> None:
        for cid, card in self._cards.items():
            card.set_selected(cid == self.selected_char_id)

        char = self._pkg.characters.get(self.selected_char_id) if self.selected_char_id else None
        if not char:
            self.selection_label.setText('Nenhum personagem selecionado.')
            self._ok_btn.setEnabled(False)
            return

        display_name = html.escape(char.name or char.id)
        text = f'<span style="color:#ffffff; font-weight:700;">{display_name}</span>'
        if char.profile:
            text += f' <span style="color:#f59e0b; font-weight:400;">— {html.escape(char.profile)}</span>'
        self.selection_label.setText(text)
        self._ok_btn.setEnabled(True)
