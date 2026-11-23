---
id: 02-sumico-na-cidade
title: Missão 2 — Sumiço na Cidade
start: CASA-042
pickup: PRACA-015
pickup_objective: Procure pistas na [PRACA-015]
target: COM-024
objective: Leve a pista para a Detetive Rosa na [COM-024]
give_item: luva-escama
require_item: luva-escama
delivery_prompt: A Detetive Rosa quer ver a pista na [COM-024]. Mostre o item:
wrong_item_message: Isso não é pista, isso é tralha. Próximo!
---

## CUTSCENE_INICIO
left: ana-laura
right: camila
bg: Rua da Dona Zuzu

- Camila: Fiz uma lista no celular: anão de jardim, bicicleta, roscas, três motos e um carrinho de pipoca. Tudo sumiu de noite.
- Ana Laura: E todo mundo diz que ouviu um ronco de motor bem alto logo antes.
- Camila: Uma testemunha viu alguém correndo pela [PRACA-015]. Vamos procurar pistas lá!
- Ana Laura: Investigação + carro? Esse é o meu tipo de trabalho.
- OPCAO: Detetive Ana Laura, a caminho! -> NEXT
- OPCAO: Se eu achar as roscas, posso ficar com uma? -> NEXT
- Camila: Se achar alguma coisa, leva direto pra Detetive Rosa na [COM-024]. Ela cuida desses sumiços.

## CUTSCENE_FIM
left: ana-laura
right: rosa
bg: Delegacia da Detetive Rosa

- Detetive Rosa: Vocês são as meninas da tal Entregas Turbo? A Dona Zuzu já contou pra delegacia inteira.
- Ana Laura: Somos! E trouxemos uma pista quentinha da [PRACA-015]:
- ENTREGAR: luva-escama
- Detetive Rosa: Uma luva com escamas de cobra... Interessante. Isso parece a marca de uma gangue.
- Ana Laura: Gangue? Tipo de filme?
- Detetive Rosa: Tipo de vida real. Preciso de mais provas. Vocês dirigem rápido, eu preciso de alguém rápido. Topam ajudar?

