# Setup — Editor Local de Histórias

Aplicação desktop multiplataforma (Windows, macOS e Linux) para criar, editar e validar histórias, personagens, itens, missões e locais sem editar arquivos Markdown manualmente.

## Pré-requisitos

- Python 3.11 ou superior

## Instalação e execução

### macOS / Linux

```bash
cd setup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

### Windows (PowerShell)

```powershell
cd setup
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

## Testes automatizados (camada de domínio e validação)

```bash
python3 -m unittest discover -s setup/tests
```
