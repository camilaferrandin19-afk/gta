from __future__ import annotations

import html
from pathlib import Path
from typing import Callable

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QBrush, QColor, QPainter, QPen, QResizeEvent, QShowEvent, QWheelEvent
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsView,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from ..core.city_catalog import (
    CityLocationMeta,
    get_official_city_layout,
    is_building_code,
    load_canonical_city_locations,
)
from ..core.models import StoryPackage


MAP_SCALE = 0.08
ISLAND_MARGIN = 12.0

KIND_COLORS = {
    'CASA': '#d97757',   # Terracota / Laranja-tijolo
    'COM': '#3b82f6',    # Azul comércio
    'PRACA': '#22c55e',  # Verde praça
    'HOSP': '#f8fafc',   # Branco hospital
    'RUA': '#1f2430',    # Asfalto escuro
}


class _SelectableMapRect(QGraphicsRectItem):
    def __init__(
        self,
        x: float,
        y: float,
        w: float,
        h: float,
        code: str,
        selectable: bool,
        on_click: Callable[[str], None],
    ) -> None:
        super().__init__(x, y, w, h)
        self.code = code
        self._selectable = selectable
        self._on_click = on_click
        if selectable:
            self.setAcceptHoverEvents(True)
            self.setCursor(Qt.CursorShape.PointingHandCursor)

    def mousePressEvent(self, event: object) -> None:
        if self._selectable:
            self._on_click(self.code)


class _ZoomableMapView(QGraphicsView):
    def __init__(self, scene: QGraphicsScene, on_manual_zoom: Callable[[], None] | None = None, parent: QWidget | None = None) -> None:
        super().__init__(scene, parent)
        self._on_manual_zoom = on_manual_zoom
        self.setRenderHint(QPainter.RenderHint.Antialiasing, True)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.ViewportAnchor.AnchorViewCenter)

    def wheelEvent(self, event: QWheelEvent) -> None:
        if event.angleDelta().y() > 0:
            if self._on_manual_zoom:
                self._on_manual_zoom()
            self.scale(1.18, 1.18)
        elif event.angleDelta().y() < 0:
            if self._on_manual_zoom:
                self._on_manual_zoom()
            self.scale(1 / 1.18, 1 / 1.18)
        else:
            super().wheelEvent(event)


class CityMapCanvas(QWidget):
    """Mapa visual proporcional à geometria oficial da cidade-base do jogo."""

    def __init__(
        self,
        canonical: dict[str, CityLocationMeta],
        on_select: Callable[[str], None],
        buildings_only: bool = False,
        allow_roads: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._canonical = canonical
        self._on_select = on_select
        self._buildings_only = buildings_only
        self._allow_roads = allow_roads
        self._pkg: StoryPackage | None = None
        self._selected_code = ''
        self._items_by_code: dict[str, _SelectableMapRect] = {}
        self._auto_fit = True

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        # Barra de legenda + controles de zoom
        top_bar = QHBoxLayout()
        top_bar.setSpacing(10)

        for label, color, border in (
            ('Casa', KIND_COLORS['CASA'], '#0e1015'),
            ('Comércio', KIND_COLORS['COM'], '#0e1015'),
            ('Praça', KIND_COLORS['PRACA'], '#0e1015'),
            ('Hospital', KIND_COLORS['HOSP'], '#ef4444'),
            ('Rua', KIND_COLORS['RUA'], '#475569'),
            ('Selecionado', '#f59e0b', '#f59e0b'),
        ):
            swatch = QLabel()
            swatch.setFixedSize(12, 12)
            swatch.setStyleSheet(
                f'background: {color}; border: 1px solid {border}; border-radius: 2px;'
            )
            txt = QLabel(label)
            txt.setStyleSheet('font-size: 11px; color: #cbd5e1;')
            top_bar.addWidget(swatch)
            top_bar.addWidget(txt)

        top_bar.addStretch(1)

        zoom_out_btn = QPushButton('-')
        zoom_out_btn.setFixedSize(32, 28)
        zoom_out_btn.setStyleSheet('padding: 0px; font-weight: 700; font-size: 15px;')
        zoom_out_btn.setToolTip('Diminuir zoom')
        zoom_out_btn.clicked.connect(lambda: self._zoom_by(1 / 1.25))

        zoom_in_btn = QPushButton('+')
        zoom_in_btn.setFixedSize(32, 28)
        zoom_in_btn.setStyleSheet('padding: 0px; font-weight: 700; font-size: 15px;')
        zoom_in_btn.setToolTip('Aumentar zoom')
        zoom_in_btn.clicked.connect(lambda: self._zoom_by(1.25))

        fit_btn = QPushButton('Ajustar')
        fit_btn.setToolTip('Ajustar mapa inteiro na janela')
        fit_btn.clicked.connect(self.fit_all)

        top_bar.addWidget(zoom_out_btn)
        top_bar.addWidget(zoom_in_btn)
        top_bar.addWidget(fit_btn)
        layout.addLayout(top_bar)

        self.scene = QGraphicsScene(self)
        self.view = _ZoomableMapView(self.scene, on_manual_zoom=self._disable_auto_fit, parent=self)
        self.view.setBackgroundBrush(QBrush(QColor('#0f2942')))
        layout.addWidget(self.view, 1)

    def _disable_auto_fit(self) -> None:
        self._auto_fit = False

    def _zoom_by(self, factor: float) -> None:
        self._auto_fit = False
        self.view.scale(factor, factor)

    def showEvent(self, event: QShowEvent) -> None:
        super().showEvent(event)
        if self._auto_fit:
            QTimer.singleShot(0, self.fit_all)

    def resizeEvent(self, event: QResizeEvent) -> None:
        super().resizeEvent(event)
        if self._auto_fit:
            QTimer.singleShot(0, self.fit_all)

    def render_map(self, pkg: StoryPackage | None, selected_code: str = '') -> None:
        self._pkg = pkg
        self._selected_code = (selected_code or '').strip().upper()
        self.scene.clear()
        self._items_by_code.clear()

        city = get_official_city_layout()
        world_w = city.world_width * MAP_SCALE
        world_h = city.world_height * MAP_SCALE

        # Base de asfalto da ilha
        island_bg = self.scene.addRect(0, 0, world_w, world_h)
        island_bg.setBrush(QBrush(QColor(KIND_COLORS['RUA'])))
        island_bg.setPen(QPen(QColor('#334155'), 1.5))
        island_bg.setZValue(0)

        # Quarteirões (calçadas / terreno)
        for blk in city.blocks:
            blk_item = self.scene.addRect(
                blk.x * MAP_SCALE,
                blk.y * MAP_SCALE,
                blk.w * MAP_SCALE,
                blk.h * MAP_SCALE,
            )
            blk_item.setBrush(QBrush(QColor('#334155')))
            blk_item.setPen(QPen(Qt.PenStyle.NoPen))
            blk_item.setZValue(1)

        # Ruas clicáveis (opcional)
        if self._allow_roads:
            for code, meta in self._canonical.items():
                if meta.kind != 'RUA' or meta.w <= 0 or meta.h <= 0:
                    continue
                is_sel = code == self._selected_code
                rect = _SelectableMapRect(
                    meta.x * MAP_SCALE,
                    meta.y * MAP_SCALE,
                    meta.w * MAP_SCALE,
                    meta.h * MAP_SCALE,
                    code,
                    True,
                    self._on_select,
                )
                rect.setBrush(QBrush(QColor(245, 158, 11, 55) if is_sel else QColor(0, 0, 0, 0)))
                rect.setPen(QPen(QColor('#f59e0b'), 1.8) if is_sel else QPen(Qt.PenStyle.NoPen))
                rect.setZValue(9 if is_sel else 2)
                loc = self._pkg.locations.get(code) if self._pkg else None
                rect.setToolTip(f'{code} — {loc.name if loc else meta.default_name}')
                self.scene.addItem(rect)
                self._items_by_code[code] = rect

        # Edificações, praças e hospitais na posição oficial
        for code, meta in self._canonical.items():
            if meta.kind == 'RUA' or meta.w <= 0 or meta.h <= 0:
                continue

            if self._buildings_only:
                selectable = is_building_code(code)
            else:
                selectable = meta.kind in ('CASA', 'COM', 'PRACA', 'HOSP')

            rect = _SelectableMapRect(
                meta.x * MAP_SCALE,
                meta.y * MAP_SCALE,
                meta.w * MAP_SCALE,
                meta.h * MAP_SCALE,
                code,
                selectable,
                self._on_select,
            )

            loc = self._pkg.locations.get(code) if self._pkg else None
            if not selectable:
                fill = QColor('#222733')
                border_col = QColor('#151922')
            elif loc and loc.roof_color:
                fill = QColor(loc.roof_color)
                border_col = QColor('#0e1015')
            elif meta.kind == 'HOSP':
                fill = QColor(KIND_COLORS['HOSP'])
                border_col = QColor('#ef4444')
            else:
                fill = QColor(KIND_COLORS.get(meta.kind, '#8d5b4c'))
                border_col = QColor('#0e1015')

            is_sel = code == self._selected_code
            rect.setBrush(QBrush(fill))
            rect.setPen(QPen(QColor('#f59e0b') if is_sel else border_col, 2.4 if is_sel else 0.7))
            rect.setZValue(10 if is_sel else 3)

            name = loc.name if loc else meta.default_name
            rect.setToolTip(f'{code} — {name}')
            self.scene.addItem(rect)
            self._items_by_code[code] = rect

        self.scene.setSceneRect(-ISLAND_MARGIN, -ISLAND_MARGIN, world_w + ISLAND_MARGIN * 2, world_h + ISLAND_MARGIN * 2)

    def fit_all(self) -> None:
        self._auto_fit = True
        if not self.scene.sceneRect().isEmpty():
            self.view.fitInView(self.scene.sceneRect(), Qt.AspectRatioMode.KeepAspectRatioByExpanding)
            if self._selected_code:
                self.focus_code(self._selected_code)
            else:
                self.view.horizontalScrollBar().setValue(self.view.horizontalScrollBar().minimum())
                self.view.verticalScrollBar().setValue(self.view.verticalScrollBar().minimum())

    def focus_code(self, code: str) -> None:
        item = self._items_by_code.get((code or '').strip().upper())
        if item is not None:
            self.view.ensureVisible(item, 80, 80)


class LocationPickerDialog(QDialog):
    """Diálogo visual para escolher um local clicando nos prédios/praças do mapa oficial."""

    def __init__(
        self,
        app_root: Path,
        pkg: StoryPackage | None,
        current_code: str = '',
        buildings_only: bool = False,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._pkg = pkg
        self._buildings_only = buildings_only
        self._canonical = load_canonical_city_locations(app_root)
        self.selected_code = (current_code or '').strip().upper()

        self.setWindowTitle('Escolher Local no Mapa')
        self.resize(820, 720)

        layout = QVBoxLayout(self)
        hint = QLabel(
            'Clique em uma edificação no mapa para selecionar (CASA/COM). Use a roda do mouse para zoom:'
            if buildings_only
            else 'Clique em uma edificação, praça ou hospital no mapa para selecionar. Use a roda do mouse para zoom:'
        )
        layout.addWidget(hint)

        self.map_canvas = CityMapCanvas(
            self._canonical,
            on_select=self._on_rect_clicked,
            buildings_only=buildings_only,
            allow_roads=False,
            parent=self,
        )
        layout.addWidget(self.map_canvas, 1)

        self.selection_label = QLabel()
        self.selection_label.setTextFormat(Qt.TextFormat.RichText)
        self.selection_label.setWordWrap(True)
        self.selection_label.setStyleSheet(
            'padding: 8px 10px; background: #141720; border: 1px solid #2b3245; '
            'border-radius: 6px; color: #f59e0b;'
        )
        layout.addWidget(self.selection_label)

        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText('Confirmar')
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText('Cancelar')
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        self._ok_btn = buttons.button(QDialogButtonBox.StandardButton.Ok)
        layout.addWidget(buttons)

        self.map_canvas.render_map(self._pkg, self.selected_code)
        self.map_canvas.fit_all()
        if self.selected_code:
            self.map_canvas.focus_code(self.selected_code)
        self._update_selection_label()

    def _location_name(self, code: str) -> str:
        if self._pkg and code in self._pkg.locations:
            return self._pkg.locations[code].name
        if code in self._canonical:
            return self._canonical[code].default_name
        return ''

    def _on_rect_clicked(self, code: str) -> None:
        self.selected_code = code
        self.map_canvas.render_map(self._pkg, self.selected_code)
        self._update_selection_label()

    def _update_selection_label(self) -> None:
        if not self.selected_code:
            self.selection_label.setText('Nenhum local selecionado.')
            self._ok_btn.setEnabled(False)
            return
        name = self._location_name(self.selected_code)
        code_html = f'<span style="color:#ffffff; font-weight:700;">{html.escape(self.selected_code)}</span>'
        if name:
            text = f'{code_html} <span style="color:#f59e0b; font-weight:400;">— {html.escape(name)}</span>'
        else:
            text = code_html
        self.selection_label.setText(text)
        valid = is_building_code(self.selected_code) if self._buildings_only else True
        self._ok_btn.setEnabled(valid)


class LocationPickerField(QWidget):
    """Campo somente leitura com botão para escolher o local clicando no mapa."""

    def __init__(
        self,
        app_root: Path,
        pkg_provider: Callable[[], StoryPackage | None],
        buildings_only: bool = False,
        allow_clear: bool = False,
        on_changed: Callable[[str], None] | None = None,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self._app_root = app_root
        self._pkg_provider = pkg_provider
        self._buildings_only = buildings_only
        self._on_changed = on_changed
        self._code = ''

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        self.display_edit = QLineEdit()
        self.display_edit.setReadOnly(True)
        self.display_edit.setPlaceholderText('Nenhum local selecionado')

        self.pick_btn = QPushButton('Escolher no Mapa...')
        self.pick_btn.clicked.connect(self._open_picker)

        layout.addWidget(self.display_edit, 1)
        layout.addWidget(self.pick_btn)

        if allow_clear:
            self.clear_btn = QPushButton('Limpar')
            self.clear_btn.clicked.connect(self._clear)
            layout.addWidget(self.clear_btn)

    def set_code(self, code: str) -> None:
        self._code = (code or '').strip().upper()
        if not self._code:
            self.display_edit.clear()
            return
        pkg = self._pkg_provider()
        loc = pkg.locations.get(self._code) if pkg else None
        self.display_edit.setText(f'{self._code} — {loc.name}' if loc else self._code)

    def code(self) -> str:
        return self._code

    def _open_picker(self) -> None:
        pkg = self._pkg_provider()
        dlg = LocationPickerDialog(
            self._app_root,
            pkg,
            current_code=self._code,
            buildings_only=self._buildings_only,
            parent=self,
        )
        if dlg.exec() == QDialog.DialogCode.Accepted and dlg.selected_code:
            self.set_code(dlg.selected_code)
            if self._on_changed:
                self._on_changed(self._code)

    def _clear(self) -> None:
        self.set_code('')
        if self._on_changed:
            self._on_changed('')
