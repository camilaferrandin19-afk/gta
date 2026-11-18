from __future__ import annotations

import re
from typing import Callable

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from ..core.models import CutsceneBlock, CutsceneStep, Encounter, Mission, StoryPackage


SLUG_RE = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')


class CutsceneStepDialog(QDialog):
    """Diálogo guiado para adicionar ou editar um passo de cutscene."""

    def __init__(self, step: CutsceneStep | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setWindowTitle('Passo da Cutscene')
        self.resize(480, 260)

        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.kind_combo = QComboBox()
        self.kind_combo.addItems(['line', 'choice', 'deliver', 'link'])
        self.speaker_edit = QLineEdit()
        self.text_edit = QLineEdit()
        self.target_edit = QLineEdit()
        self.reason_edit = QLineEdit()

        form.addRow('Tipo:', self.kind_combo)
        form.addRow('Falante (line):', self.speaker_edit)
        form.addRow('Texto / Rótulo / Item:', self.text_edit)
        form.addRow('Destino (NEXT/FAIL/URL):', self.target_edit)
        form.addRow('Motivo falha (FAIL):', self.reason_edit)

        layout.addLayout(form)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        if step:
            self.kind_combo.setCurrentText(step.kind)
            self.speaker_edit.setText(step.speaker)
            self.text_edit.setText(step.text)
            self.target_edit.setText(step.target)
            self.reason_edit.setText(step.reason)

    def to_step(self) -> CutsceneStep:
        return CutsceneStep(
            kind=self.kind_combo.currentText(),
            speaker=self.speaker_edit.text().strip(),
            text=self.text_edit.text().strip(),
            target=self.target_edit.text().strip() or 'NEXT',
            reason=self.reason_edit.text().strip(),
        )


class CutsceneEditorWidget(QGroupBox):
    """Editor visual para um bloco de cutscene (left, right, bg e passos)."""

    def __init__(self, title: str, on_changed: Callable[[], None] | None = None, parent: QWidget | None = None) -> None:
        super().__init__(title, parent)
        self._block: CutsceneBlock | None = None
        self._on_changed = on_changed
        self._suppress = False

        layout = QVBoxLayout(self)
        top_form = QFormLayout()
        self.left_combo = QComboBox()
        self.left_combo.setEditable(True)
        self.right_combo = QComboBox()
        self.right_combo.setEditable(True)
        self.bg_edit = QLineEdit()
        top_form.addRow('Personagem esq.:', self.left_combo)
        top_form.addRow('Personagem dir.:', self.right_combo)
        top_form.addRow('Cenário (bg):', self.bg_edit)
        layout.addLayout(top_form)

        self.table = QTableWidget(0, 4)
        self.table.setHorizontalHeaderLabels(['Tipo', 'Falante', 'Texto / Item', 'Destino / URL'])
        self.table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setMinimumHeight(140)
        layout.addWidget(self.table)

        btn_row = QHBoxLayout()
        for label, cb in (
            ('+ Passo', self._on_add_step),
            ('Editar', self._on_edit_step),
            ('Subir', lambda: self._move_step(-1)),
            ('Descer', lambda: self._move_step(1)),
            ('Remover', self._on_remove_step),
        ):
            btn = QPushButton(label)
            btn.clicked.connect(cb)
            btn_row.addWidget(btn)
        layout.addLayout(btn_row)

        self.left_combo.currentTextChanged.connect(self._sync_meta)
        self.right_combo.currentTextChanged.connect(self._sync_meta)
        self.bg_edit.textChanged.connect(self._sync_meta)

    def set_character_choices(self, char_ids: list[str]) -> None:
        self._suppress = True
        cur_left = self.left_combo.currentText()
        cur_right = self.right_combo.currentText()
        choices = [''] + char_ids + ['none']
        self.left_combo.clear()
        self.right_combo.clear()
        self.left_combo.addItems(choices)
        self.right_combo.addItems(choices)
        self.left_combo.setCurrentText(cur_left)
        self.right_combo.setCurrentText(cur_right)
        self._suppress = False

    def load_block(self, block: CutsceneBlock | None) -> None:
        self._suppress = True
        self._block = block
        if not block:
            self.left_combo.setCurrentText('')
            self.right_combo.setCurrentText('')
            self.bg_edit.clear()
            self.table.setRowCount(0)
            self._suppress = False
            return
        self.left_combo.setCurrentText(block.left)
        self.right_combo.setCurrentText(block.right)
        self.bg_edit.setText(block.bg)
        self._refresh_table()
        self._suppress = False

    def _refresh_table(self) -> None:
        if not self._block:
            self.table.setRowCount(0)
            return
        self.table.setRowCount(len(self._block.steps))
        for row, step in enumerate(self._block.steps):
            self.table.setItem(row, 0, QTableWidgetItem(step.kind))
            self.table.setItem(row, 1, QTableWidgetItem(step.speaker))
            self.table.setItem(row, 2, QTableWidgetItem(step.text))
            dest = f'FAIL: {step.reason}' if step.target == 'FAIL' and step.reason else step.target
            self.table.setItem(row, 3, QTableWidgetItem(dest if step.kind in ('choice', 'link') else ''))

    def _sync_meta(self) -> None:
        if self._suppress or not self._block:
            return
        self._block.left = self.left_combo.currentText().strip()
        self._block.right = self.right_combo.currentText().strip()
        self._block.bg = self.bg_edit.text().strip()
        if self._on_changed:
            self._on_changed()

    def _on_add_step(self) -> None:
        if not self._block:
            return
        dlg = CutsceneStepDialog(parent=self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._block.steps.append(dlg.to_step())
            self._refresh_table()
            if self._on_changed:
                self._on_changed()

    def _on_edit_step(self) -> None:
        row = self.table.currentRow()
        if not self._block or row < 0 or row >= len(self._block.steps):
            return
        dlg = CutsceneStepDialog(self._block.steps[row], parent=self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self._block.steps[row] = dlg.to_step()
            self._refresh_table()
            if self._on_changed:
                self._on_changed()

    def _move_step(self, delta: int) -> None:
        row = self.table.currentRow()
        if not self._block or row < 0:
            return
        new_row = row + delta
        if new_row < 0 or new_row >= len(self._block.steps):
            return
        self._block.steps[row], self._block.steps[new_row] = self._block.steps[new_row], self._block.steps[row]
        self._refresh_table()
        self.table.selectRow(new_row)
        if self._on_changed:
            self._on_changed()

    def _on_remove_step(self) -> None:
        row = self.table.currentRow()
        if not self._block or row < 0 or row >= len(self._block.steps):
            return
        self._block.steps.pop(row)
        self._refresh_table()
        if self._on_changed:
            self._on_changed()


class MissionsAndEncountersTab(QWidget):
    """Aba unificada de Missões Principais (com reordenação) e Encontros Extras."""

    def __init__(self, on_data_changed: Callable[[], None] | None = None, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._pkg: StoryPackage | None = None
        self._current_mission_id: str | None = None
        self._current_enc_id: str | None = None
        self._on_data_changed = on_data_changed

        layout = QVBoxLayout(self)
        self.subtabs = QTabWidget()
        layout.addWidget(self.subtabs)

        self.subtabs.addTab(self._build_missions_tab(), 'Missões Principais')
        self.subtabs.addTab(self._build_encounters_tab(), 'Encontros Extras')

    def _build_missions_tab(self) -> QWidget:
        splitter = QSplitter()

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        self.mission_list = QListWidget()
        self.mission_list.currentItemChanged.connect(self._on_mission_selected)

        row1 = QHBoxLayout()
        add_btn = QPushButton('+ Nova Missão')
        add_btn.setObjectName('PrimaryButton')
        del_btn = QPushButton('Excluir')
        del_btn.setObjectName('DangerButton')
        add_btn.clicked.connect(self._on_add_mission)
        del_btn.clicked.connect(self._on_del_mission)
        row1.addWidget(add_btn)
        row1.addWidget(del_btn)

        row2 = QHBoxLayout()
        up_btn = QPushButton('Subir')
        down_btn = QPushButton('Descer')
        up_btn.clicked.connect(lambda: self._move_mission(-1))
        down_btn.clicked.connect(lambda: self._move_mission(1))
        row2.addWidget(up_btn)
        row2.addWidget(down_btn)

        left_layout.addWidget(self.mission_list, 1)
        left_layout.addLayout(row1)
        left_layout.addLayout(row2)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        right_container = QWidget()
        right_layout = QVBoxLayout(right_container)

        form_group = QGroupBox('Configuração da Missão')
        form = QFormLayout(form_group)
        self.m_id = QLineEdit()
        self.m_id.setReadOnly(True)
        self.m_title = QLineEdit()
        self.m_start = QLineEdit()
        self.m_pickup = QLineEdit()
        self.m_pickup_obj = QLineEdit()
        self.m_target = QLineEdit()
        self.m_objective = QLineEdit()
        self.m_give_item = QComboBox()
        self.m_give_item.setEditable(True)
        self.m_require_item = QComboBox()
        self.m_require_item.setEditable(True)
        self.m_delivery_prompt = QLineEdit()
        self.m_wrong_msg = QLineEdit()

        form.addRow('ID:', self.m_id)
        form.addRow('Título:', self.m_title)
        form.addRow('Início (start):', self.m_start)
        form.addRow('Coleta opcional (pickup):', self.m_pickup)
        form.addRow('Objetivo coleta:', self.m_pickup_obj)
        form.addRow('Destino (target):', self.m_target)
        form.addRow('Objetivo principal:', self.m_objective)
        form.addRow('Concede item (give_item):', self.m_give_item)
        form.addRow('Exige item (require_item):', self.m_require_item)
        form.addRow('Prompt entrega:', self.m_delivery_prompt)
        form.addRow('Msg item errado:', self.m_wrong_msg)

        self.cs_inicio = CutsceneEditorWidget('Cutscene Inicial', on_changed=self._on_data_changed)
        self.cs_fim = CutsceneEditorWidget('Cutscene Final', on_changed=self._on_data_changed)

        right_layout.addWidget(form_group)
        right_layout.addWidget(self.cs_inicio)
        right_layout.addWidget(self.cs_fim)
        scroll.setWidget(right_container)

        splitter.addWidget(left_panel)
        splitter.addWidget(scroll)
        splitter.setSizes([260, 640])

        for widget in (
            self.m_title, self.m_start, self.m_pickup, self.m_pickup_obj,
            self.m_target, self.m_objective, self.m_delivery_prompt, self.m_wrong_msg,
        ):
            widget.textChanged.connect(self._sync_mission)
        self.m_give_item.currentTextChanged.connect(self._sync_mission)
        self.m_require_item.currentTextChanged.connect(self._sync_mission)

        return splitter

    def _build_encounters_tab(self) -> QWidget:
        splitter = QSplitter()

        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        self.enc_list = QListWidget()
        self.enc_list.currentItemChanged.connect(self._on_enc_selected)

        row = QHBoxLayout()
        add_btn = QPushButton('+ Novo Encontro')
        add_btn.setObjectName('PrimaryButton')
        del_btn = QPushButton('Excluir')
        del_btn.setObjectName('DangerButton')
        add_btn.clicked.connect(self._on_add_enc)
        del_btn.clicked.connect(self._on_del_enc)
        row.addWidget(add_btn)
        row.addWidget(del_btn)
        left_layout.addWidget(self.enc_list, 1)
        left_layout.addLayout(row)

        right_container = QWidget()
        right_layout = QVBoxLayout(right_container)
        form_group = QGroupBox('Encontro Extra em Construção')
        form = QFormLayout(form_group)
        self.e_id = QLineEdit()
        self.e_id.setReadOnly(True)
        self.e_npc = QComboBox()
        self.e_npc.setEditable(True)
        self.e_loc = QLineEdit()
        self.e_prompt = QLineEdit()
        form.addRow('ID:', self.e_id)
        form.addRow('Personagem NPC:', self.e_npc)
        form.addRow('Edificação (CASA/COM):', self.e_loc)
        form.addRow('Texto da ação:', self.e_prompt)

        self.e_cutscene = CutsceneEditorWidget('Cutscene do Encontro', on_changed=self._on_data_changed)
        right_layout.addWidget(form_group)
        right_layout.addWidget(self.e_cutscene, 1)

        splitter.addWidget(left_panel)
        splitter.addWidget(right_container)
        splitter.setSizes([260, 640])

        self.e_npc.currentTextChanged.connect(self._sync_enc)
        self.e_loc.textChanged.connect(self._sync_enc)
        self.e_prompt.textChanged.connect(self._sync_enc)
        return splitter

    def load_package(self, pkg: StoryPackage | None) -> None:
        self._pkg = pkg
        self._current_mission_id = None
        self._current_enc_id = None
        self.mission_list.clear()
        self.enc_list.clear()
        if not pkg:
            return

        self.refresh_reference_choices()

        for mid in pkg.missions_order:
            m = pkg.missions.get(mid)
            if not m:
                continue
            item = QListWidgetItem(f'{m.title} ({m.id})')
            item.setData(256, mid)
            self.mission_list.addItem(item)
        if self.mission_list.count() > 0:
            self.mission_list.setCurrentRow(0)

        for eid in pkg.encounters_order:
            enc = pkg.encounters.get(eid)
            if not enc:
                continue
            item = QListWidgetItem(f'{enc.id} ({enc.location})')
            item.setData(256, eid)
            self.enc_list.addItem(item)
        if self.enc_list.count() > 0:
            self.enc_list.setCurrentRow(0)

    def refresh_reference_choices(self) -> None:
        if not self._pkg:
            return
        char_ids = list(self._pkg.characters.keys())
        item_ids = [''] + list(self._pkg.items.keys())
        self.cs_inicio.set_character_choices(char_ids)
        self.cs_fim.set_character_choices(char_ids)
        self.e_cutscene.set_character_choices(char_ids)

        cur_npc = self.e_npc.currentText()
        self.e_npc.clear()
        self.e_npc.addItems(char_ids)
        self.e_npc.setCurrentText(cur_npc)

        cur_give = self.m_give_item.currentText()
        cur_req = self.m_require_item.currentText()
        self.m_give_item.clear()
        self.m_require_item.clear()
        self.m_give_item.addItems(item_ids)
        self.m_require_item.addItems(item_ids)
        self.m_give_item.setCurrentText(cur_give)
        self.m_require_item.setCurrentText(cur_req)

    def _on_mission_selected(self, current: QListWidgetItem | None) -> None:
        if not current or not self._pkg:
            return
        mid = current.data(256)
        m = self._pkg.missions.get(mid)
        if not m:
            return
        self._current_mission_id = None
        self.m_id.setText(m.id)
        self.m_title.setText(m.title)
        self.m_start.setText(m.start)
        self.m_pickup.setText(m.pickup)
        self.m_pickup_obj.setText(m.pickup_objective)
        self.m_target.setText(m.target)
        self.m_objective.setText(m.objective)
        self.m_give_item.setCurrentText(m.give_item)
        self.m_require_item.setCurrentText(m.require_item)
        self.m_delivery_prompt.setText(m.delivery_prompt)
        self.m_wrong_msg.setText(m.wrong_item_message)
        self.cs_inicio.load_block(m.cutscene_inicio)
        self.cs_fim.load_block(m.cutscene_fim)
        self._current_mission_id = mid

    def _sync_mission(self) -> None:
        if not self._pkg or not self._current_mission_id:
            return
        m = self._pkg.missions.get(self._current_mission_id)
        if not m:
            return
        m.title = self.m_title.text().strip()
        m.start = self.m_start.text().strip().upper()
        m.pickup = self.m_pickup.text().strip().upper()
        m.pickup_objective = self.m_pickup_obj.text().strip()
        m.target = self.m_target.text().strip().upper()
        m.objective = self.m_objective.text().strip()
        m.give_item = self.m_give_item.currentText().strip()
        m.require_item = self.m_require_item.currentText().strip()
        m.delivery_prompt = self.m_delivery_prompt.text().strip()
        m.wrong_item_message = self.m_wrong_msg.text().strip()
        item = self.mission_list.currentItem()
        if item:
            item.setText(f'{m.title or m.id} ({m.id})')
        if self._on_data_changed:
            self._on_data_changed()

    def _on_add_mission(self) -> None:
        if not self._pkg:
            return
        raw_id, ok = QInputDialog.getText(self, 'Nova Missão', 'Identificador (ex.: 06-entrega-final):')
        if not ok:
            return
        mid = raw_id.strip().lower()
        if not SLUG_RE.match(mid):
            QMessageBox.warning(self, 'ID inválido', 'Use apenas letras minúsculas, números e hífen.')
            return
        if mid in self._pkg.missions:
            QMessageBox.warning(self, 'Duplicado', f'Já existe uma missão "{mid}".')
            return
        chars = list(self._pkg.characters.keys())
        c1 = chars[0] if chars else ''
        c2 = chars[1] if len(chars) > 1 else c1
        m = Mission(
            id=mid,
            title='Nova Missão',
            start='CASA-01',
            target='PRACA-01',
            objective='Vá até PRACA-01.',
            cutscene_inicio=CutsceneBlock(name='CUTSCENE_INICIO', left=c1, right=c2, bg='Frente da CASA-01'),
            cutscene_fim=CutsceneBlock(name='CUTSCENE_FIM', left=c1, right=c2, bg='PRACA-01'),
        )
        self._pkg.missions[mid] = m
        self._pkg.missions_order.append(mid)
        self.load_package(self._pkg)
        self.mission_list.setCurrentRow(self.mission_list.count() - 1)
        if self._on_data_changed:
            self._on_data_changed()

    def _on_del_mission(self) -> None:
        if not self._pkg or not self._current_mission_id:
            return
        if len(self._pkg.missions) <= 1:
            QMessageBox.warning(self, 'Bloqueado', 'A história precisa manter ao menos 1 missão principal.')
            return
        mid = self._current_mission_id
        self._pkg.missions.pop(mid, None)
        self._pkg.missions_order = [m for m in self._pkg.missions_order if m != mid]
        self.load_package(self._pkg)
        if self._on_data_changed:
            self._on_data_changed()

    def _move_mission(self, delta: int) -> None:
        if not self._pkg:
            return
        row = self.mission_list.currentRow()
        new_row = row + delta
        if row < 0 or new_row < 0 or new_row >= len(self._pkg.missions_order):
            return
        order = self._pkg.missions_order
        order[row], order[new_row] = order[new_row], order[row]
        self.load_package(self._pkg)
        self.mission_list.setCurrentRow(new_row)
        if self._on_data_changed:
            self._on_data_changed()

    def _on_enc_selected(self, current: QListWidgetItem | None) -> None:
        if not current or not self._pkg:
            return
        eid = current.data(256)
        enc = self._pkg.encounters.get(eid)
        if not enc:
            return
        self._current_enc_id = None
        self.e_id.setText(enc.id)
        self.e_npc.setCurrentText(enc.npc)
        self.e_loc.setText(enc.location)
        self.e_prompt.setText(enc.prompt)
        self.e_cutscene.load_block(enc.cutscene)
        self._current_enc_id = eid

    def _sync_enc(self) -> None:
        if not self._pkg or not self._current_enc_id:
            return
        enc = self._pkg.encounters.get(self._current_enc_id)
        if not enc:
            return
        enc.npc = self.e_npc.currentText().strip()
        enc.location = self.e_loc.text().strip().upper()
        enc.prompt = self.e_prompt.text().strip()
        item = self.enc_list.currentItem()
        if item:
            item.setText(f'{enc.id} ({enc.location})')
        if self._on_data_changed:
            self._on_data_changed()

    def _on_add_enc(self) -> None:
        if not self._pkg:
            return
        raw_id, ok = QInputDialog.getText(self, 'Novo Encontro Extra', 'Identificador (ex.: extra-oficina):')
        if not ok:
            return
        eid = raw_id.strip().lower()
        if not SLUG_RE.match(eid):
            QMessageBox.warning(self, 'ID inválido', 'Use apenas letras minúsculas, números e hífen.')
            return
        if eid in self._pkg.encounters or eid in self._pkg.missions:
            QMessageBox.warning(self, 'Duplicado', f'Identificador "{eid}" já existe.')
            return
        chars = list(self._pkg.characters.keys())
        npc = chars[0] if chars else ''
        enc = Encounter(
            id=eid,
            npc=npc,
            location='CASA-01',
            prompt='Conversar na CASA-01',
            cutscene=CutsceneBlock(name='CUTSCENE', left=npc, right=npc, bg='Interior da CASA-01'),
        )
        self._pkg.encounters[eid] = enc
        self._pkg.encounters_order.append(eid)
        self.load_package(self._pkg)
        self.enc_list.setCurrentRow(self.enc_list.count() - 1)
        if self._on_data_changed:
            self._on_data_changed()

    def _on_del_enc(self) -> None:
        if not self._pkg or not self._current_enc_id:
            return
        eid = self._current_enc_id
        self._pkg.encounters.pop(eid, None)
        self._pkg.encounters_order = [e for e in self._pkg.encounters_order if e != eid]
        self.load_package(self._pkg)
        if self._on_data_changed:
            self._on_data_changed()
