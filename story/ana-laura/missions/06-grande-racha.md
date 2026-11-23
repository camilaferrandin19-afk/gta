---
id: 06-grande-racha
title: Missão 6 — O Grande Racha
start: COM-554
pickup: PRACA-021
pickup_objective: Vá para a largada e pegue a Bandeira Quadriculada na [PRACA-021]
target: CASA-353
objective: CORRA! Cruze a linha de chegada no [CASA-353] antes do Víbora
give_item: bandeira-quadriculada
require_item: bandeira-quadriculada
delivery_prompt: Linha de chegada! Mostre a bandeira para a Detetive Rosa no [CASA-353]:
wrong_item_message: Isso não vale como chegada! Cadê a bandeira?
---

## CUTSCENE_INICIO
left: ana-laura
right: vibora
bg: Largada do Grande Racha

- Víbora: Olha só quem apareceu. Achei que você ia ficar em casa fazendo entregas de bolo.
- Ana Laura: Faço entregas de bolo E ganho rachas. Conheço essa cidade de olhos fechados.
- Víbora: Regras: pega a bandeira na largada e chega primeiro no Mirante. Se eu ganhar, o Ana Turbo é meu. Pra sempre.
- Ana Laura: E se EU ganhar, você conta onde escondeu tudo o que roubou. O anão da Dona Zuzu inclusive!
- OPCAO: Fechado. Prepare-se pra comer poeira! -> NEXT
- OPCAO: Pode ir na frente... vou precisar de você pra ver o caminho. -> NEXT
- Víbora: Três... dois... UM!

## CUTSCENE_FIM
left: ana-laura
right: rosa
bg: Mirante — Linha de Chegada

- Detetive Rosa: Ana Laura cruzou a linha em primeiro! O Víbora chegou depois... de ré.
- Ana Laura: Ganhei! E aqui está a bandeira da vitória:
- ENTREGAR: bandeira-quadriculada
- Detetive Rosa: E o Víbora confessou tudo: as coisas roubadas estavam no porão do galpão. Bicicletas, motos, roscas... e um anão de jardim muito assustado.
- Ana Laura: A Dona Zuzu vai chorar de alegria!
- Detetive Rosa: A cidade inteira deve isso a vocês. Ah, e a delegacia precisa de entregas rápidas. Vocês fazem desconto pra polícia?
- Ana Laura: Pra senhora, entrega grátis!
- Narrador: As Serpentes foram desfeitas, o Víbora está lavando viaturas como castigo, e a Entregas Turbo virou a empresa mais famosa da cidade.
- Narrador: Missão cumprida! Agora você está livre para explorar a cidade, ganhar dinheiro com combos ou repetir qualquer missão pelo menu de pausa.
