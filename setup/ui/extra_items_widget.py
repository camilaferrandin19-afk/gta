from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtWidgets import (
    QComboBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..core.models import ExtraItemPlacement, StoryPackage
from .map_picker import LocationPickerField


RARITY_OPTIONS = ('normal', 'especial', 'lendario')


class ExtraItemsGroupWidget(QGroupBox):
    """Editor reutilizável de posicionamento de itens extras (## ITENS ou collectibles)."""

    def __init__(
        self,
        title: str,
        app_root: Path,
        pkg_provider: Callable[[], StoryPackage | None],
        on_changed: Callable[[], None] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(title, parent)
        self._app_root = app_root
        self._pkg_provider = pkg_provider
        self._on_changed = on_changed
        self._placements: list[ExtraItemPlacement] = []

        root = QVBoxLayout(self)
        root.setSpacing(6)

        header = QHBoxLayout()
        self.empty_label = QLabel('Nenhum item extra posicionado.')
        self.empty_label.setObjectName('MutedLabel')
        self.add_btn = QPushButton('+ Adicionar Item Extra')
        self.add_btn.clicked.connect(self._on_add)
        header.addWidget(self.empty_label, 1)
        header.addWidget(self.add_btn)
        root.addLayout(header)

        self.rows_layout = QVBoxLayout()
        self.rows_layout.setSpacing(6)
        root.addLayout(self.rows_layout)

    def load_placements(self, placements: list[ExtraItemPlacement]) -> None:
        self._placements = placements
        self._rebuild_rows()

    def _rebuild_rows(self) -> None:
        while self.rows_layout.count():
            child = self.rows_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        self.empty_label.setVisible(len(self._placements) == 0)
        pkg = self._pkg_provider()
        item_entries = [
            (iid, f'{it.name or iid} ({iid})')
            for iid, it in (pkg.items.items() if pkg else ())
        ]

        for idx, placement in enumerate(self._placements):
            row_widget = QWidget()
            row = QHBoxLayout(row_widget)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(6)

            item_combo = QComboBox()
            for iid, label in item_entries:
                item_combo.addItem(label, iid)
            pos = item_combo.findData(placement.item_id)
            if pos >= 0:
                item_combo.setCurrentIndex(pos)
            elif placement.item_id:
                item_combo.addItem(placement.item_id, placement.item_id)
                item_combo.setCurrentIndex(item_combo.count() - 1)

            loc_picker = LocationPickerField(
                self._app_root,
                self._pkg_provider,
                on_changed=lambda code, p=placement: self._update_location(p, code),
            )
            loc_picker.set_code(placement.location)

            rarity_combo = QComboBox()
            rarity_combo.addItems(list(RARITY_OPTIONS))
            rarity_val = (placement.rarity or 'normal').lower()
            rarity_combo.setCurrentText(rarity_val if rarity_val in RARITY_OPTIONS else 'normal')

            del_btn = QPushButton('Remover')
            del_btn.setObjectName('DangerButton')

            item_combo.currentIndexChanged.connect(
                lambda _i, c=item_combo, p=placement: self._update_item(p, str(c.currentData() or ''))
            )
            rarity_combo.currentTextChanged.connect(
                lambda txt, p=placement: self._update_rarity(p, txt)
            )
            del_btn.clicked.connect(lambda _checked=False, i=idx: self._on_remove(i))

            row.addWidget(item_combo, 2)
            row.addWidget(loc_picker, 2)
            row.addWidget(rarity_combo, 1)
            row.addWidget(del_btn)
            self.rows_layout.addWidget(row_widget)

    def _update_item(self, placement: ExtraItemPlacement, item_id: str) -> None:
        placement.item_id = item_id
        if self._on_changed:
            self._on_changed()

    def _update_location(self, placement: ExtraItemPlacement, location: str) -> None:
        placement.location = location
        if self._on_changed:
            self._on_changed()

    def _update_rarity(self, placement: ExtraItemPlacement, rarity: str) -> None:
        placement.rarity = rarity
        if self._on_changed:
            self._on_changed()

    def _on_add(self) -> None:
        pkg = self._pkg_provider()
        if not pkg or not pkg.items:
            return
        used_ids = {p.item_id for p in self._placements}
        candidate = next((iid for iid in pkg.items if iid not in used_ids), next(iter(pkg.items)))
        self._placements.append(ExtraItemPlacement(item_id=candidate, location='PRACA-001', rarity='normal'))
        self._rebuild_rows()
        if self._on_changed:
            self._on_changed()

    def _on_remove(self, idx: int) -> None:
        if 0 <= idx < len(self._placements):
            self._placements.pop(idx)
            self._rebuild_rows()
            if self._on_changed:
                self._on_changed()
