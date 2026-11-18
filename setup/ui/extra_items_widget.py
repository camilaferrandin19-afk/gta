from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QComboBox,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..core.models import ExtraItemPlacement, StoryPackage
from .item_picker import ItemPickerDialog
from .map_picker import LocationPickerField
from .widgets import AssetPreviewWidget


RARITY_OPTIONS = ('normal', 'especial', 'lendario')


def collect_placed_item_ids(
    pkg: StoryPackage | None,
    exclude: ExtraItemPlacement | None = None,
) -> set[str]:
    """Retorna todos os IDs de itens já posicionados no mapa (collectibles, ## ITENS e pickup)."""
    if not pkg:
        return set()
    placed: set[str] = set()
    for col in pkg.collectibles:
        if col is not exclude and col.item_id:
            placed.add(col.item_id)
    for mission in pkg.missions.values():
        if mission.pickup and mission.give_item:
            placed.add(mission.give_item)
        for ex in mission.extra_items:
            if ex is not exclude and ex.item_id:
                placed.add(ex.item_id)
    return placed


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
        self.add_btn = QPushButton('+ Adicionar')
        self.add_btn.setObjectName('PrimaryButton')
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

    def _item_image_path(self, pkg: StoryPackage | None, item_id: str) -> Path | None:
        if not pkg or not item_id:
            return None
        item = pkg.items.get(item_id)
        if not item or not item.image:
            return None
        return self._app_root / 'story' / pkg.id / item.image

    def _rebuild_rows(self) -> None:
        while self.rows_layout.count():
            child = self.rows_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

        self.empty_label.setVisible(len(self._placements) == 0)
        pkg = self._pkg_provider()

        for idx, placement in enumerate(self._placements):
            row_widget = QWidget()
            row = QHBoxLayout(row_widget)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(8)

            item_def = pkg.items.get(placement.item_id) if pkg else None
            icon_btn = QPushButton()
            icon_btn.setFixedSize(44, 44)
            icon_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            icon_btn.setToolTip(
                f'{item_def.name} ({placement.item_id}) — clique para trocar'
                if item_def
                else f'{placement.item_id} — clique para trocar'
            )
            icon_btn.setStyleSheet(
                'QPushButton { background: #141720; border: 1px solid #2b3245; border-radius: 6px; padding: 2px; }'
                'QPushButton:hover { border: 1px solid #f59e0b; }'
            )
            btn_layout = QHBoxLayout(icon_btn)
            btn_layout.setContentsMargins(3, 3, 3, 3)
            btn_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
            preview = AssetPreviewWidget(34, parent=icon_btn)
            preview.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents, True)
            preview.load_file(self._item_image_path(pkg, placement.item_id))
            btn_layout.addWidget(preview)
            icon_btn.clicked.connect(lambda _checked=False, p=placement: self._on_pick_for_row(p))

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

            rarity_combo.currentTextChanged.connect(
                lambda txt, p=placement: self._update_rarity(p, txt)
            )
            del_btn.clicked.connect(lambda _checked=False, i=idx: self._on_remove(i))

            row.addWidget(icon_btn)
            row.addWidget(loc_picker, 2)
            row.addWidget(rarity_combo, 1)
            row.addWidget(del_btn)
            self.rows_layout.addWidget(row_widget)

    def _on_pick_for_row(self, placement: ExtraItemPlacement) -> None:
        pkg = self._pkg_provider()
        if not pkg:
            return
        excluded = collect_placed_item_ids(pkg, exclude=placement)
        dlg = ItemPickerDialog(
            self._app_root,
            pkg,
            current_item_id=placement.item_id,
            excluded_item_ids=excluded,
            parent=self,
        )
        if dlg.exec() != ItemPickerDialog.DialogCode.Accepted:
            return
        chosen = dlg.selected_item_id
        if not chosen:
            return
        if chosen in collect_placed_item_ids(pkg, exclude=placement):
            QMessageBox.warning(
                self,
                'Item já posicionado',
                f'O item "{chosen}" já está posicionado em outro local do mapa.',
            )
            return
        placement.item_id = chosen
        self._rebuild_rows()
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
        excluded = collect_placed_item_ids(pkg)
        available = [iid for iid in pkg.items if iid not in excluded]
        if not available:
            QMessageBox.information(
                self,
                'Sem itens disponíveis',
                'Todos os itens cadastrados na história já estão posicionados no mapa.',
            )
            return
        dlg = ItemPickerDialog(
            self._app_root,
            pkg,
            current_item_id='',
            excluded_item_ids=excluded,
            parent=self,
        )
        if dlg.exec() != ItemPickerDialog.DialogCode.Accepted:
            return
        chosen = dlg.selected_item_id
        if not chosen:
            return
        if chosen in collect_placed_item_ids(pkg):
            QMessageBox.warning(
                self,
                'Item já posicionado',
                f'O item "{chosen}" já está posicionado em outro local do mapa.',
            )
            return
        self._placements.append(ExtraItemPlacement(item_id=chosen, location='PRACA-001', rarity='normal'))
        self._rebuild_rows()
        if self._on_changed:
            self._on_changed()

    def _on_remove(self, idx: int) -> None:
        if 0 <= idx < len(self._placements):
            self._placements.pop(idx)
            self._rebuild_rows()
            if self._on_changed:
                self._on_changed()
