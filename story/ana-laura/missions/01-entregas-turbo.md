---
id: 01-entregas-turbo
title: Missão 1 — Entregas Turbo
start: CASA-001
pickup: PRACA-001
pickup_objective: Pegue o Bolo de Três Andares na [PRACA-001]
target: CASA-042
objective: Entregue o bolo para a Dona Zuzu na [CASA-042]
give_item: bolo-casamento
require_item: bolo-casamento
delivery_prompt: A Dona Zuzu está esperando o bolo na [CASA-042]. Escolha o item:
wrong_item_message: Isso não é bolo, minha filha! Nem com muita fome!
---

## CUTSCENE_INICIO
left: ana-laura
right: camila
bg: Frente da Casa da Ana e da Camila

- Camila: Ana! Acabei de pintar a placa: ENTREGAS TURBO — se demorar, a gente chega antes!
- Ana Laura: Ficou linda! Só que a gente ainda não tem nenhum cliente...
- Camila: Tinha! A Dona Zuzu ligou agora: o bolo de casamento da sobrinha dela ficou na [PRACA-001] e a festa começa já já.
- Ana Laura: Um bolo de três andares no banco do carro? O que pode dar errado?
- OPCAO: Bora! Primeira entrega da Entregas Turbo! -> NEXT
- OPCAO: Vou devagar nas curvas... talvez. -> NEXT
- Camila: Pega o bolo na [PRACA-001] e leva pra [CASA-042]. Ah, e não derrapa! Chantilly não volta pro lugar.

## CUTSCENE_FIM
left: ana-laura
right: zuzu
bg: Portão da Casa da Dona Zuzu

- Dona Zuzu: Ai, que meninas de ouro! Chegou inteirinho? Nem um morango fora do lugar?
- Ana Laura: Inteirinho, Dona Zuzu! Só o andar de cima ficou um pouquinho... criativo.
- ENTREGAR: bolo-casamento
- Dona Zuzu: Perfeito! Vou contar pra rua inteira que a Entregas Turbo é a melhor da cidade.
- Dona Zuzu: Mas olha... estão acontecendo coisas estranhas. Ontem sumiu o meu anão de jardim. O Seu Lima perdeu a bicicleta, e a padaria, todas as roscas!
- Ana Laura: Roubaram as roscas?! Isso é sério. Camila, acho que temos um mistério pra resolver.

