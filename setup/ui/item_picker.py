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

from ..core.models import Item, StoryPackage
from .widgets import AssetPreviewWidget


GRID_COLUMNS = 4


class ItemGridCard(QFrame):
    """Card clicável com a imagem de um item na grade de seleção."""

    def __init__(
        self,
        item: Item,
        image_path: Path | None,
        on_click: Callable[[str], None],
        card_size: int = 104,
        icon_size: int = 80,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.item_id = item.id
        self._on_click = on_click
        self.setFixedSize(card_size, card_size)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setToolTip(f'{item.name or item.id} ({item.id})')

        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.preview = AssetPreviewWidget(icon_size, parent=self)
        self.preview.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
        self.preview.load_file(image_path)
        layout.addWidget(self.preview)

        self.set_selected(False)

    def update_card(self, item: Item, image_path: Path | None) -> None:
        self.setToolTip(f'{item.name or item.id} ({item.id})')
        self.preview.load_file(image_path)

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
            self._on_click(self.item_id)
        super().mousePressEvent(event)


class ItemPickerDialog(QDialog):
    """Diálogo com grade visual rolável para escolher um item pela imagem."""

    def __init__(
        self,
        app_root: Path,
        pkg: StoryPackage,
        current_item_id: str = '',
        excluded_item_ids: set[str] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._pkg = pkg
        self._story_dir = app_root / 'story' / pkg.id
        self._excluded = set(excluded_item_ids or set())
        self.selected_item_id = (current_item_id or '').strip()
        if self.selected_item_id in self._excluded:
            self.selected_item_id = ''
        self._cards: dict[str, ItemGridCard] = {}

        self.setWindowTitle('Escolher Item')
        self.resize(520, 460)

        layout = QVBoxLayout(self)
        hint = QLabel('Clique na imagem do item para selecioná-lo:')
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

        ordered_ids = list(pkg.items_order)
        for iid in pkg.items:
            if iid not in ordered_ids:
                ordered_ids.append(iid)

        idx = 0
        for iid in ordered_ids:
            if iid in self._excluded:
                continue
            item = pkg.items.get(iid)
            if not item:
                continue
            img_path = (self._story_dir / item.image) if item.image else None
            card = ItemGridCard(item, img_path, self._on_card_clicked, parent=grid_container)
            row = idx // GRID_COLUMNS
            col = idx % GRID_COLUMNS
            grid.addWidget(card, row, col)
            self._cards[iid] = card
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

    def _on_card_clicked(self, item_id: str) -> None:
        self.selected_item_id = item_id
        self._update_selection()

    def _update_selection(self) -> None:
        for iid, card in self._cards.items():
            card.set_selected(iid == self.selected_item_id)

        item = self._pkg.items.get(self.selected_item_id) if self.selected_item_id else None
        if not item:
            if not self._cards:
                self.selection_label.setText('Nenhum item disponível (todos já estão posicionados no mapa).')
            else:
                self.selection_label.setText('Nenhum item selecionado.')
            self._ok_btn.setEnabled(False)
            return

        display_name = html.escape(item.name or item.id)
        desc = html.escape(item.description or item.id)
        self.selection_label.setText(
            f'<span style="color:#ffffff; font-weight:700;">{display_name}</span> '
            f'<span style="color:#f59e0b; font-weight:400;">— {desc}</span>'
        )
        self._ok_btn.setEnabled(True)
