---
id: 03-pista-da-cobra
title: Missão 3 — A Pista da Cobra
start: COM-024
pickup: PRACA-005
pickup_objective: Pegue a foto da câmera de segurança na [PRACA-005]
target: COM-554
objective: Leve a foto para o Toninho identificar o carro na [COM-554]
give_item: foto-camera
require_item: foto-camera
delivery_prompt: O Toninho vai analisar a foto na [COM-554]. Escolha o item:
wrong_item_message: Isso aí não é foto, é pegadinha! Cadê a imagem?
---

## CUTSCENE_INICIO
left: ana-laura
right: rosa
bg: Frente da Delegacia

- Detetive Rosa: A câmera do banco da [PRACA-005] filmou o último sumiço. O vigia imprimiu a foto pra mim.
- Ana Laura: E por que a senhora mesma não vai buscar?
- Detetive Rosa: Porque a minha viatura está com o pneu furado. De novo. Isso também é suspeito.
- OPCAO: Deixa com a gente, detetive! -> NEXT
- OPCAO: Pneu furado? Conheço o mecânico certo! -> NEXT
- Detetive Rosa: Pega a foto na [PRACA-005]. Se der pra ver o carro, leva pra um mecânico de confiança dizer que modelo é.
- Ana Laura: Já sei quem: o Toninho, na [COM-554]. Ele reconhece um carro só pelo barulho!

## CUTSCENE_FIM
left: ana-laura
right: toninho
bg: Oficina do Toninho

- Toninho: Ana Laura! Veio trocar o óleo ou trazer fofoca?
- Ana Laura: Os dois. Olha essa foto da câmera de segurança:
- ENTREGAR: foto-camera
- Toninho: Ih... carro preto rebaixado, adesivo de cobra no vidro e placa S3RP-3NT. Esse é o carro do Víbora!
- Ana Laura: Víbora?
- Toninho: O chefe das Serpentes. Ele se acha o rei dos rachas e pega tudo que acha que é dele. E ele já me perguntou do seu carro, o Ana Turbo...
- Ana Laura: Peraí... Camila? CAMILA! O Ana Turbo sumiu da porta da oficina!

