---
id: 05-turbo-novinho
title: Missão 5 — Turbo Novinho
start: CASA-656
pickup: PRACA-029
pickup_objective: Pegue o Turbo Novinho na [PRACA-029]
target: COM-554
objective: Leve o turbo para o Toninho instalar na [COM-554]
give_item: turbo-novo
require_item: turbo-novo
delivery_prompt: O Toninho está pronto para instalar o turbo na [COM-554]:
wrong_item_message: Isso não dá nem pra turbinar liquidificador! Cadê o turbo?
---

## CUTSCENE_INICIO
left: ana-laura
right: toninho
bg: Ligação da Oficina do Toninho

- Toninho: Fiquei sabendo do bilhete do Víbora. Ele quer racha? Então a gente vai turbinar o Ana Turbo como nunca!
- Ana Laura: Mas ele levou o turbo!
- Toninho: Eu encomendei um novinho, mais forte que o original. O caminhão deixou a caixa na [PRACA-029].
- Ana Laura: Toninho, você é um gênio!
- Toninho: Eu sei. Pega a caixa e traz aqui. E vem devagar, que turbo novo não pode levar pancada!

## CUTSCENE_FIM
left: ana-laura
right: toninho
bg: Oficina do Toninho

- Toninho: Opa! Deixa eu ver essa belezura:
- ENTREGAR: turbo-novo
- Toninho: Aperta aqui, solda ali, um pouco de fita... e PRONTO! O Ana Turbo está mais rápido do que nunca.
- Ana Laura: Ele está até brilhando!
- Toninho: Isso é graxa, mas tudo bem. A Detetive Rosa ligou: o Víbora marcou o Grande Racha. Largada na [PRACA-021], chegada no [CASA-353].
- Ana Laura: E se eu ganhar?
- Toninho: Se você ganhar, ele vai ter que contar onde escondeu todas as coisas roubadas. E a Rosa vai estar te esperando na chegada.

