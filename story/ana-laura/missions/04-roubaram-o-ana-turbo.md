---
id: 04-roubaram-o-ana-turbo
title: Missão 4 — Roubaram o Ana Turbo!
start: COM-554
pickup: PRACA-025
pickup_objective: Pegue o Controle do Portão no território das Serpentes, na [PRACA-025]
target: CASA-656
objective: Leve o controle até a Camila no [CASA-656] para abrir o galpão
give_item: controle-portao
require_item: controle-portao
delivery_prompt: A Camila está na porta do [CASA-656]. Entregue o controle:
wrong_item_message: Isso não abre portão nenhum, Ana! Cadê o controle?
---

## CUTSCENE_INICIO
left: ana-laura
right: vibora
bg: Ligação de número desconhecido

- Víbora: Alô? É a dona do carrinho rosa? Que máquina linda... agora ela é MINHA.
- Ana Laura: Víbora! Devolve o Ana Turbo agora!
- Víbora: Hahaha! Ele está trancado num galpão que você nunca vai achar. E o único controle do portão está com a minha gangue.
- OPCAO: Pode esperar, eu vou buscar! -> NEXT
- OPCAO: Você mexeu com a pessoa errada. -> NEXT
- OPCAO: Tá bom, pode ficar com ele. -> GAMEOVER: A Ana Laura NUNCA desiste do Ana Turbo! Tente de novo.
- Víbora: Quero só ver. As Serpentes estão te esperando na [PRACA-025]. Cuidado pra não chamar a polícia!
- Ana Laura: A Camila descobriu pelo GPS: o carro está no [CASA-656]. Pego o controle e encontro ela lá!

## CUTSCENE_FIM
left: ana-laura
right: camila
bg: Portão do Galpão Abandonado

- Camila: Ana! Você está inteira? Vi daqui umas três viaturas passando...
- Ana Laura: Detalhe. Olha o que eu peguei das Serpentes:
- ENTREGAR: controle-portao
- Camila: O portão abriu! E lá está ele... o Ana Turbo! Ai, mas ele está sem o turbo!
- Ana Laura: Aquele Víbora arrancou o turbo do meu carro?!
- Camila: Tem um bilhete no banco: "Sem turbo você não ganha de ninguém. Me encontra no Grande Racha, se tiver coragem. — V."
- Ana Laura: Ah, ele vai ter o racha dele. E vai perder.

