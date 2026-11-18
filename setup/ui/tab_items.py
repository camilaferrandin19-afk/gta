from __future__ import annotations

from pathlib import Path
import re
from typing import Callable

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QInputDialog,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from ..core.models import Item, StoryPackage
from ..core.validator import find_dependents
from .item_picker import ItemGridCard
from .widgets import AssetPickerRow


SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
GRID_COLUMNS = 3


class ItemsTab(QWidget):
    """Aba de gerenciamento do catálogo puro de itens da história."""

    def __init__(
        self,
        app_root: Path,
        story_dir_provider: Callable[[], Path | None],
        on_data_changed: Callable[[], None] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._story_dir_provider = story_dir_provider
        self._pkg: StoryPackage | None = None
        self._current_id: str | None = None
        self._on_data_changed = on_data_changed
        self._cards: dict[str, ItemGridCard] = {}

        layout = QVBoxLayout(self)
        splitter = QSplitter()
        layout.addWidget(splitter)

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)

        self.grid_scroll = QScrollArea()
        self.grid_scroll.setWidgetResizable(True)
        self.grid_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        self.grid_container = QWidget()
        self.grid_layout = QGridLayout(self.grid_container)
        self.grid_layout.setSpacing(8)
        self.grid_layout.setContentsMargins(6, 6, 6, 6)
        self.grid_layout.setAlignment(Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft)
        self.grid_scroll.setWidget(self.grid_container)

        btn_row = QHBoxLayout()
        self.add_btn = QPushButton('+ Novo Item')
        self.add_btn.setObjectName('PrimaryButton')
        self.del_btn = QPushButton('Excluir')
        self.del_btn.setObjectName('DangerButton')
        self.add_btn.clicked.connect(self._on_add)
        self.del_btn.clicked.connect(self._on_delete)
        btn_row.addWidget(self.add_btn)
        btn_row.addWidget(self.del_btn)

        left_layout.addWidget(self.grid_scroll, 1)
        left_layout.addLayout(btn_row)

        right_group = QGroupBox('Detalhes do Item')
        right_layout = QVBoxLayout(right_group)
        right_layout.setSpacing(10)

        form = QFormLayout()
        form.setSpacing(10)
        form.setFieldGrowthPolicy(QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)

        self.id_edit = QLineEdit()
        self.id_edit.setReadOnly(True)
        self.name_edit = QLineEdit()
        self.desc_edit = QLineEdit()
        self.image_picker = AssetPickerRow(story_dir_provider, subdir='assets', on_changed=lambda _: self._sync())

        form.addRow('ID:', self.id_edit)
        form.addRow('Nome:', self.name_edit)
        form.addRow('Descrição:', self.desc_edit)
        form.addRow('Imagem:', self.image_picker)

        right_layout.addLayout(form)
        right_layout.addStretch(1)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_group)
        splitter.setSizes([310, 560])

        self.name_edit.textChanged.connect(self._sync)
        self.desc_edit.textChanged.connect(self._sync)

    def _item_image_path(self, item: Item) -> Path | None:
        story_dir = self._story_dir_provider()
        if not story_dir or not item.image:
            return None
        return story_dir / item.image

    def _clear_grid(self) -> None:
        self._cards.clear()
        while self.grid_layout.count():
            child = self.grid_layout.takeAt(0)
            if child.widget():
                child.widget().deleteLater()

    def load_package(self, pkg: StoryPackage | None, select_id: str | None = None) -> None:
        self._pkg = pkg
        self._current_id = None
        self._clear_grid()
        if not pkg:
            self._clear_form()
            return
        ordered = list(pkg.items_order)
        for iid in pkg.items:
            if iid not in ordered:
                ordered.append(iid)

        idx = 0
        for iid in ordered:
            item = pkg.items.get(iid)
            if not item:
                continue
            card = ItemGridCard(
                item,
                self._item_image_path(item),
                self._select_item,
                card_size=86,
                icon_size=64,
                parent=self.grid_container,
            )
            self.grid_layout.addWidget(card, idx // GRID_COLUMNS, idx % GRID_COLUMNS)
            self._cards[iid] = card
            idx += 1

        target_id = select_id if (select_id and select_id in self._cards) else (ordered[0] if ordered and ordered[0] in self._cards else None)
        if target_id:
            self._select_item(target_id)
        else:
            self._clear_form()

    def _clear_form(self) -> None:
        self._current_id = None
        self.id_edit.clear()
        self.name_edit.clear()
        self.desc_edit.clear()
        self.image_picker.set_value('')

    def _select_item(self, iid: str) -> None:
        if not self._pkg:
            return
        item = self._pkg.items.get(iid)
        if not item:
            return
        for card_id, card in self._cards.items():
            card.set_selected(card_id == iid)
        self._current_id = None
        self.id_edit.setText(item.id)
        self.name_edit.setText(item.name)
        self.desc_edit.setText(item.description)
        self.image_picker.set_value(item.image)
        self._current_id = iid

    def _sync(self) -> None:
        if not self._pkg or not self._current_id:
            return
        item = self._pkg.items.get(self._current_id)
        if not item:
            return
        item.name = self.name_edit.text().strip()
        item.description = self.desc_edit.text().strip()
        item.image = self.image_picker.value()
        card = self._cards.get(self._current_id)
        if card:
            card.update_card(item, self._item_image_path(item))
        if self._on_data_changed:
            self._on_data_changed()

    def _on_add(self) -> None:
        if not self._pkg:
            return
        raw_id, ok = QInputDialog.getText(self, 'Novo Item', 'Identificador (ex.: chave-dourada):')
        if not ok:
            return
        iid = raw_id.strip().lower()
        if not SLUG_RE.match(iid):
            QMessageBox.warning(self, 'ID inválido', 'Use apenas letras minúsculas, números e hífen.')
            return
        if iid in self._pkg.items:
            QMessageBox.warning(self, 'Duplicado', f'Já existe um item com ID "{iid}".')
            return
        item = Item(id=iid, name=iid.replace('-', ' ').title())
        self._pkg.items[iid] = item
        self._pkg.items_order.append(iid)
        self.load_package(self._pkg, select_id=iid)
        if self._on_data_changed:
            self._on_data_changed()

    def _on_delete(self) -> None:
        if not self._pkg or not self._current_id:
            return
        refs = find_dependents(self._pkg, 'item', self._current_id)
        if refs:
            QMessageBox.warning(
                self,
                'Exclusão bloqueada',
                f'O item "{self._current_id}" está em uso e não pode ser excluído:\n\n• ' + '\n• '.join(refs),
            )
            return
        iid = self._current_id
        self._pkg.items.pop(iid, None)
        self._pkg.items_order = [i for i in self._pkg.items_order if i != iid]
        self.load_package(self._pkg)
        if self._on_data_changed:
            self._on_data_changed()
