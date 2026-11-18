from __future__ import annotations

from pathlib import Path
from typing import Callable

from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QColorDialog,
    QComboBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from ..core.city_catalog import is_building_code, load_canonical_city_locations
from ..core.models import MapLocation, StoryPackage
from .map_picker import CityMapCanvas
from .widgets import AssetPickerRow


class MapLocationsTab(QWidget):
    """Aba de gerenciamento de ruas, estabelecimentos, cor e logo do telhado."""

    def __init__(
        self,
        app_root: Path,
        story_dir_provider: Callable[[], Path | None],
        on_data_changed: Callable[[], None] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._pkg: StoryPackage | None = None
        self._current_code: str | None = None
        self._on_data_changed = on_data_changed
        self._canonical = load_canonical_city_locations(app_root)
        self._suppress = False

        layout = QVBoxLayout(self)
        splitter = QSplitter()
        layout.addWidget(splitter)

        # Painel esquerdo: filtros + lista de locais
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        filter_row = QHBoxLayout()
        self.search_edit = QLineEdit()
        self.search_edit.setPlaceholderText('Buscar por código ou nome...')
        self.kind_filter = QComboBox()
        self.kind_filter.addItems(['TODOS', 'CASA', 'COM', 'PRACA', 'HOSP', 'RUA'])
        filter_row.addWidget(self.search_edit, 1)
        filter_row.addWidget(self.kind_filter)

        self.loc_list = QListWidget()
        self.loc_list.currentItemChanged.connect(self._on_list_selected)
        left_layout.addLayout(filter_row)
        left_layout.addWidget(self.loc_list, 1)

        # Painel direito: mapa visual + editor do local selecionado
        right_panel = QWidget()
        right_layout = QVBoxLayout(right_panel)

        map_group = QGroupBox('Mapa Visual da Cidade-Base (clique para selecionar local; use o scroll para zoom)')
        map_layout = QVBoxLayout(map_group)
        self.map_canvas = CityMapCanvas(
            self._canonical,
            on_select=self.select_code,
            buildings_only=False,
            allow_roads=True,
            parent=self,
        )
        self.map_canvas.setMinimumHeight(280)
        map_layout.addWidget(self.map_canvas)

        edit_group = QGroupBox('Personalização do Local')
        form = QFormLayout(edit_group)
        self.code_label = QLabel('—')
        self.kind_label = QLabel('—')
        self.name_edit = QLineEdit()

        color_row = QHBoxLayout()
        self.color_edit = QLineEdit()
        self.color_edit.setPlaceholderText('Padrão do mapa (ex.: #413dc8)')
        self.color_btn = QPushButton('Escolher Cor...')
        self.color_clear_btn = QPushButton('Padrão')
        self.color_btn.clicked.connect(self._pick_color)
        self.color_clear_btn.clicked.connect(self._clear_color)
        color_row.addWidget(self.color_edit, 1)
        color_row.addWidget(self.color_btn)
        color_row.addWidget(self.color_clear_btn)

        self.logo_picker = AssetPickerRow(
            story_dir_provider,
            subdir='assets',
            allow_clear=True,
            on_changed=lambda _: self._sync(),
        )

        form.addRow('Código:', self.code_label)
        form.addRow('Tipo:', self.kind_label)
        form.addRow('Nome de exibição:', self.name_edit)
        form.addRow('Cor do telhado:', color_row)
        form.addRow('Logo no teto (opcional):', self.logo_picker)

        right_layout.addWidget(map_group, 1)
        right_layout.addWidget(edit_group)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_panel)
        splitter.setSizes([300, 620])

        self.search_edit.textChanged.connect(self._refresh_list)
        self.kind_filter.currentTextChanged.connect(self._refresh_list)
        self.name_edit.textChanged.connect(self._sync)
        self.color_edit.textChanged.connect(self._sync)

    def load_package(self, pkg: StoryPackage | None) -> None:
        self._pkg = pkg
        self._current_code = None
        self._refresh_list()
        self._draw_visual_map(fit=True)

    def _refresh_list(self) -> None:
        self.loc_list.clear()
        if not self._pkg:
            return
        query = self.search_edit.text().strip().lower()
        kind = self.kind_filter.currentText()
        for code in sorted(self._pkg.locations.keys()):
            loc = self._pkg.locations[code]
            if kind != 'TODOS' and loc.kind != kind:
                continue
            if query and query not in code.lower() and query not in loc.name.lower():
                continue
            badge = ' [telhado]' if loc.roof_color or loc.roof_logo else ''
            item = QListWidgetItem(f'{code} — {loc.name}{badge}')
            item.setData(256, code)
            self.loc_list.addItem(item)

    def _draw_visual_map(self, fit: bool = False) -> None:
        if not self._pkg:
            self.map_canvas.scene.clear()
            return
        self.map_canvas.render_map(self._pkg, self._current_code or '')
        if fit:
            self.map_canvas.fit_all()

    def select_code(self, code: str) -> None:
        if not self._pkg or code not in self._pkg.locations:
            return
        self._load_location(self._pkg.locations[code])
        for row in range(self.loc_list.count()):
            item = self.loc_list.item(row)
            if item.data(256) == code:
                self.loc_list.setCurrentRow(row)
                break
        self._draw_visual_map()
        self.map_canvas.focus_code(code)

    def _on_list_selected(self, current: QListWidgetItem | None) -> None:
        if not current or not self._pkg:
            return
        code = current.data(256)
        loc = self._pkg.locations.get(code)
        if loc:
            self._load_location(loc)
            self._draw_visual_map()
            self.map_canvas.focus_code(code)

    def _load_location(self, loc: MapLocation) -> None:
        self._suppress = True
        self._current_code = loc.code
        self.code_label.setText(loc.code)
        self.kind_label.setText(loc.kind or 'LOCAL')
        self.name_edit.setText(loc.name)
        self.color_edit.setText(loc.roof_color)
        self.logo_picker.set_value(loc.roof_logo)

        editable_roof = is_building_code(loc.code)
        self.color_edit.setEnabled(editable_roof)
        self.color_btn.setEnabled(editable_roof)
        self.color_clear_btn.setEnabled(editable_roof)
        self.logo_picker.setEnabled(editable_roof)
        self._suppress = False

    def _pick_color(self) -> None:
        if not self._current_code or not is_building_code(self._current_code):
            QMessageBox.information(self, 'Não aplicável', 'Apenas edificações (CASA-* e COM-*) possuem telhado.')
            return
        initial = QColor(self.color_edit.text().strip() or '#d6282e')
        color = QColorDialog.getColor(initial, self, 'Escolher cor do telhado')
        if color.isValid():
            self.color_edit.setText(color.name().lower())

    def _clear_color(self) -> None:
        self.color_edit.clear()

    def _sync(self) -> None:
        if self._suppress or not self._pkg or not self._current_code:
            return
        loc = self._pkg.locations.get(self._current_code)
        if not loc:
            return
        loc.name = self.name_edit.text().strip() or loc.name
        if is_building_code(loc.code):
            loc.roof_color = self.color_edit.text().strip().lower()
            loc.roof_logo = self.logo_picker.value()
        item = self.loc_list.currentItem()
        if item and item.data(256) == loc.code:
            badge = ' [telhado]' if loc.roof_color or loc.roof_logo else ''
            item.setText(f'{loc.code} — {loc.name}{badge}')
        self._draw_visual_map()
        if self._on_data_changed:
            self._on_data_changed()
