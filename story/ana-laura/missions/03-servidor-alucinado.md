---
id: 03-servidor-alucinado
title: Missão 3 — O Servidor Alucinado
start: COM-024
pickup: PRACA-005
pickup_objective: Resgate o Servidor em [PRACA-005]
target: COM-554
objective: Leve o Servidor para Pundar Sichai em [COM-554]
give_item: servidor
require_item: servidor
delivery_prompt: Pundar Sichai aguarda o Servidor em Nuvem em [COM-554]. Escolha o item:
wrong_item_message: Pesquisei aqui e esse não é o Servidor em Nuvem!
---

## CUTSCENE_INICIO
left: ana-laura
right: pundar
bg: Frente do COM-024

- Pundar Sichai: Olá, Ana Laura! Que bom falar com você! Estou com um pequeno bug... digamos, um bug de escala planetária.
- Ana Laura: Eita, Pundar Sichai! O que aconteceu com o buscador dessa vez?
- Pundar Sichai: Um dos nossos servidores portáteis caiu na [PRACA-005] e começou a responder qualquer pergunta com "Depende, tente reiniciar o roteador".
- OPCAO: Clássico! Essa resposta resolve 80% do suporte técnico! -> NEXT
- OPCAO: Relaxa, Pundar! Vou buscar esse servidor agora! -> NEXT
- OPCAO: Só falta ele começar a cobrar assinatura mensal! -> NEXT
- Pundar Sichai: Haha, essa foi boa! Resgata o servidor na [PRACA-005] e traz para mim dentro de [COM-554], lá no Sudoeste da ilha. Isso já está no topo do meu roadmap!

## CUTSCENE_FIM
left: ana-laura
right: pundar
bg: Interior do COM-554

- Pundar Sichai: Ana Laura, você é mais rápida que busca com autocompletar! Conseguiu recuperar o servidor?
- Ana Laura: Consegui, mas ele quase tentou me convencer a usar HTML para programar backend. Aqui está:
- ENTREGAR: servidor
- Pundar Sichai: Perfeito! Com o servidor de volta na nuvem, a indexação voltou ao normal.
- Ana Laura: Missão cumprida então?
- Pundar Sichai: Quase! Recebi um alerta do Sam Maltmon lá do Sudeste. Um robô dele tentou fazer deploy na sexta-feira às 18h e saiu desmontando pela rua. Ele precisa muito de você!
