# agentX Bridge

**Data de consolidação:** 2026-05-04
**Estrutura reorganizada:** 2026-05-06

Este repositório contém o **agentX**, um CLI chamado `agentx` para usar o
**OpenCode como interface primária** para estudos e automação, preservando o
ecossistema já existente no **Gemini CLI**. Instalações antigas do `ogb` são
migradas pelo bootstrap, mas o comando público novo é `agentx`.

A ideia central:

```text
Gemini CLI = fonte da verdade atual
OpenCode   = interface principal nova
agentX     = camada que sincroniza, converte, expande e valida recursos
```

O projeto começou como handoff/spec, mas hoje o caminho principal é produto: código do CLI, instaladores, workflows e documentação de uso.

## Onde começar

Leia nesta ordem:

1. [`README.md`](README.md) — fluxo atual de instalação e uso.
2. [`ROADMAP.md`](ROADMAP.md) — mapa atual do produto e prioridades.
3. [`docs/01-cheat-sheet.md`](docs/01-cheat-sheet.md) — visão de bolso do projeto.
4. [`docs/12-dia-a-dia.md`](docs/12-dia-a-dia.md) — fluxo curto de uso diario.
5. [`docs/04-architecture.md`](docs/04-architecture.md) — arquitetura do bridge.
6. [`docs/17-cli-command-spec.md`](docs/17-cli-command-spec.md) — comandos do `agentx`.

Material histórico de handoff e MVP antigo fica em [`docs/archive/`](docs/archive/).

## Princípios fixados

- **Gemini-first:** o `GEMINI.md` e recursos Gemini existentes continuam sendo a fonte inicial de verdade.
- **OpenCode-primary:** o OpenCode vira a interface principal de uso diário.
- **Projeção gerada:** arquivos OpenCode gerados não devem ser editados manualmente.
- **Sincronização confiável:** toda conversão deve ser reproduzível, validável e reversível.
- **Não programação primeiro:** o foco primário é estudo e automação; programação é um caso secundário.
- **macOS e Linux estáveis, Windows suportado com validação extra:** os instaladores POSIX usam o mesmo núcleo no macOS/Linux; o instalador PowerShell replica o perfil, mas deve ser testado em um PC/VM Windows antes de mandar para muita gente.

## Workflow recomendado agora

Instalação local a partir deste checkout:

```bash
scripts/install-mac.sh --project "$PWD"
```

No Linux:

```bash
scripts/install-linux.sh --project "$PWD"
```

No Windows, em PowerShell:

```powershell
.\scripts\install-windows.ps1 -Project $PWD
```

Esses instaladores agora fazem quatro coisas: instalam o `agentx`, limpam artefatos
de projeto que versões antigas possam ter criado por engano no home, instalam o
OpenCode se ele ainda não existir e aplicam o perfil agentX do OpenCode
globalmente. A limpeza faz backup em
`~/.config/agentx/backups/home-cleanup/` antes de remover
`~/opencode.jsonc` ou arquivos agentX dentro de `~/.opencode`. A pasta central
mantem ate 5 sessoes por operacao e exclui sessoes com mais de 30 dias. Esse
perfil inclui
plugins, `/research`, `/upgrade-ogb`, DCP, websearch, PTY, auto-fallback, YOLO,
o preset global `AGENTS.md` e a cadeia de fallback dos subagentes. O conteúdo
próprio do Gemini CLI de cada pessoa não é copiado; ele é lido e projetado
localmente pelo `agentx sync`.

Para o websearch nativo do OpenCode funcionar com Exa, o instalador tambem
garante `OPENCODE_ENABLE_EXA=1`: no Mac ele cria ou atualiza
`~/.config/zsh/.zshrc`; no Linux ele grava em `~/.profile` e tambem em
`~/.bashrc`, `~/.zshrc` ou `~/.config/fish/config.fish` quando esse for o shell
de login; no Windows ele grava a variável de ambiente de usuário.

Quando `--project` aponta para o home (`~`), o instalador não cria setup de
projeto. Ele ainda roda o sync global para gerar
`~/.config/agentx/generated/GEMINI.expanded.md` e injetar esse
arquivo no contexto global do OpenCode via `instructions`. Se nao existir
`~/.gemini/GEMINI.md`, os `GEMINI.md` das extensoes Gemini instaladas tambem
alimentam esse contexto global.

Para resetar de verdade o perfil global depois de instalar ou atualizar o agentX,
rode `agentx reset` a partir do home. Ele so aceita home como projeto e pede
confirmacao antes de limpar artefatos antigos e sobrescrever o perfil global.
Esse reset tambem reinstala o plugin global agentX do OpenCode:

```bash
cd ~
agentx reset
```

Importação inicial:

```bash
cd packages/agentx
npm install
npm run build
node dist/cli.js --project /caminho/do/projeto setup-ux
node dist/cli.js --project /caminho/do/projeto import
node dist/cli.js --project /caminho/do/projeto setup-opencode
```

Instalação rápida por GitHub Release. Se existir uma instalação antiga do
`ogb`, o instalador remove o binário/pacote legado antes de instalar `agentx`;
os dados locais são preservados e migrados no primeiro run.

```bash
# macOS
curl -fsSL https://raw.githubusercontent.com/augustocaruso/agentx/main/scripts/bootstrap-mac.sh | bash
```

```bash
# Linux
curl -fsSL https://raw.githubusercontent.com/augustocaruso/agentx/main/scripts/bootstrap-linux.sh | bash
```

No Windows, pelo PowerShell:

```powershell
iwr -UseB https://raw.githubusercontent.com/augustocaruso/agentx/main/scripts/bootstrap-windows.ps1 | iex
```

Quando o CLI `agentx` ja esta instalado e voce quer reaplicar o perfil sem baixar
release pack de novo:

```bash
agentx --project "$PWD" install
agentx --project "$PWD" install --dry-run
agentx --project "$PWD" install --force
```

O `install` e o wrapper publico para reinstalar perfil OpenCode, plugin de
startup, comandos globais/projeto e rodar a verificação final. O comando de
GitHub Release continua sendo o caminho para instalar o binario do zero.

Update depois que o `agentx` ja esta instalado:

```bash
agentx --project "$PWD" update
agentx --project "$PWD" update --dry-run
agentx --project "$PWD" update --release v0.2.14
agentx --project "$PWD" check-update
agentx --project "$PWD" auto-update
```

O `update` instala a release escolhida, reaplica o perfil agentX/OpenCode e em
seguida roda uma verificação reparadora para regenerar sync, doctor, validation,
security-check e dashboard. Ele nao copia secrets, sessoes
ou conteudo unico do Gemini CLI da pessoa; esse conteudo continua sendo lido
localmente pelo sync.
O `auto-update` compara a versao local com a ultima GitHub Release, aplica a
release nova quando existir, grava `.opencode/generated/agentx-update-status.json`
e tambem roda o mesmo check completo; por padrao ele nao tenta instalar/atualizar
o proprio OpenCode enquanto o OpenCode ja esta aberto.

Depois de atualizar uma maquina que deve ficar com o perfil global limpo, rode:

```bash
cd ~
agentx reset
```

Dia a dia:

```bash
agentx sync
agentx doctor
agentx check
agentx dashboard
opencode
opencode --agent YOLO
agentx launch --yolo
```

Se voce abrir o `agentx` ou o `opencode` diretamente no diretorio home (`~`), o
agentX entra em modo home. Nesse modo ele usa os arquivos globais e nao cria
projeto dentro da home: nada de `~/.opencode`, nada de `~/opencode.jsonc` e
nada de perfil `.opencode/agentx.config.jsonc` ali. O perfil OpenCode global fica
em `~/.config/opencode/`, e os relatorios/estado do agentX ficam em
`~/.config/agentx/generated/`. Para ter configuracao de projeto,
abra uma pasta de projeto fora do home.

No modo home, `agentx sync` e `agentx import` sincronizam recursos globais do Gemini:
`~/.gemini/GEMINI.md` e `~/.gemini/extensions/*/GEMINI.md` sao expandidos para
`~/.config/agentx/generated/GEMINI.expanded.md`, e esse conteúdo
expandido é injetado no contexto via `instructions` em
`~/.config/opencode/opencode.json`. O `setup-ux`/`reset` sobrescreve
`~/.config/opencode/AGENTS.md` com o preset agentX; o `sync` não usa esse arquivo
como fonte de verdade. Comandos vão para `~/.config/opencode/commands/`, agents para
`~/.config/opencode/agents/` e skills para `~/.config/opencode/skills/`.
Comandos/agents/skills vindos de extensoes Gemini tambem entram nesses
diretórios globais. MCPs compativeis de `~/.gemini/settings.json` e dos
manifestos das extensoes Gemini entram em `~/.config/opencode/opencode.json`.
Hooks `BeforeTool`/`AfterTool` de `settings.json` e das extensoes Gemini sao
sincronizados pelo plugin agentX do OpenCode; scripts soltos continuam apenas
inventariados para revisao.

Para limpar manualmente a bagunca deixada por instalacoes antigas no home:

```bash
agentx cleanup-home
agentx cleanup-home --dry-run
```

O Rulesync entra como auxiliar opcional no `agentx import` e no `agentx sync`: o bridge roda a conversão em staging temporário, promove apenas arquivos seguros/gerenciados e mantém `GEMINI.md` como fonte de verdade.

Use `agentx check` quando quiser o caminho verde completo: ele roda setup local,
atualiza Gemini Extensions antes do sync, sincroniza, roda doctor, validação,
segurança e dashboard, e grava
`.opencode/generated/agentx-pass.json`. Hooks compativeis de extensoes Gemini
entram no runtime do OpenCode automaticamente no proximo sync/startup.

O `setup-ux` tambem deixa o OpenCode global com `default_agent: "YOLO"` e
instala o agente YOLO globalmente, entao abrir `opencode` em uma pasta agentX sem
override local entra no YOLO. Se um projeto quiser outro padrao, defina
`openCode.defaultAgent` no perfil agentX dele.

O modo YOLO e instalado como agente separado do OpenCode:

```text
.opencode/agents/YOLO.md
```

Ele deixa as permissoes declaradas do agente `YOLO` em `allow`, incluindo
`edit`, `bash`, `task` e `external_directory`; as permissoes globais continuam
mais conservadoras.

Para abrir diretamente no YOLO:

```bash
opencode --agent YOLO
agentx launch --yolo
```

Para deixar o YOLO como agente padrao do projeto distribuido pelo agentX:

```jsonc
{
  "openCode": {
    "defaultAgent": "YOLO"
  }
}
```

Esse bloco fica em `.opencode/agentx.config.jsonc`; o `agentx sync` traduz isso para
`default_agent` no `opencode.jsonc`.

O sync tambem instala comandos de uso diario dentro do OpenCode:

```text
/bridge
/doctor
/sync
/resources
/status
/validate
/security-check
/telemetry
/update-extensions
/upgrade-ogb
```

Extensoes Gemini podem ser instaladas ou atualizadas pelo wrapper do bridge:

```bash
agentx install-extension https://github.com/usuario/extensao.git --ref gemini-cli-extension
agentx update-extensions --auto-consent
```

Comandos, skills, MCPs, `GEMINI.md`, subagentes e hooks compativeis de
`settings.json`/extensoes sao projetados para OpenCode. Subagentes projetados
podem ler, editar e criar arquivos por padrao; comandos de terminal continuam
em `bash: ask`.
Hooks `BeforeTool`/`AfterTool` rodam pelo plugin agentX sem etapa manual de trust.
Scripts soltos continuam no mapa de risco para revisao; se um script revisado
mudar depois, `agentx security-check` falha ate voce revisar de novo.

Fallback de modelo para subagentes e configuravel pelo usuario em:

```text
.opencode/agentx.config.jsonc
```

Exemplo:

```jsonc
{
  "modelFallbacks": {
    "agents": {
      "med-flashcard-maker": {
        "model": { "id": "openai/gpt-5.5", "variant": "xhigh" },
        "fallback_models": [
          { "model": "openai/gpt-5.4-mini", "variant": "medium" },
          { "model": "google/gemini-2.5-flash-lite", "effort": "low" }
        ]
      }
    }
  }
}
```

O agentX preserva o modelo importado da extensao como primeira escolha quando ele
existe. Se voce colocar `model`, esse modelo vira a primeira escolha sem editar
o subagente original. `variant`/`effort` aqui significam esforco de raciocinio;
o agentX traduz isso para `reasoningEffort` nos agentes OpenCode, registra a
decisao em `.opencode/generated/agentx-model-routing.json` e gera config opcional
para `opencode-auto-fallback`, que faz retry/cooldown quando a chamada falha em
runtime. O `doctor` e o `bridge` avisam se plugin, config ou modelo estiverem
faltando.

A hierarquia e simples:

- `agents.<nome>` ganha de tudo;
- `extensions.<nome-da-extensao>` vale para os subagentes daquela extensao;
- `allExtensionAgents` vale para todos os subagentes projetados.

Sync bidirecional seguro, primeira versao:

```bash
agentx bidirectional-sync --dry-run
agentx bidirectional-sync --force
```

ou junto do sync normal:

```bash
agentx sync --bidirectional --dry-run
```

Nesta fase ele sincroniza apenas regras Markdown de usuario entre Gemini,
OpenCode e Codex, com conflito por padrao e backup central em
`~/.config/agentx/backups/` antes de sobrescrever. A retencao
automatica mantem ate 5 sessoes por operacao e remove sessoes com mais de 30 dias.

Setup OpenCode com sync no startup:

```bash
agentx setup-opencode
```

Esse comando instala um plugin local em `.opencode/plugins/`, grava a configuração em `.opencode/generated/agentx-startup-sync.json`, valida o comando de startup e roda `doctor`. Quando um update real acontece via `agentx update` ou `auto-update`, o agentX roda o ritual completo (`check`: setup, sync, doctor, validate, security-check e dashboard) antes de devolver o controle. No startup, o plugin checa update sem aplicar automaticamente por padrão, roda `agentx sync`, grava `.opencode/generated/agentx-plugin-status.json` e `.opencode/generated/agentx-update-status.json`, registra telemetria local best-effort, atualiza `.opencode/generated/agentx-dashboard.md` e mostra toast de sucesso/falha quando a TUI permite. O caminho mais confiável ainda é abrir pelo wrapper:

```bash
agentx launch
```

Telemetria local-first:

```bash
agentx telemetry status
agentx telemetry setup-email
agentx telemetry preview --since 7d
agentx telemetry send --since 7d
agentx telemetry disable
```

Por padrao ela grava apenas registros locais redigidos em
`~/.config/agentx/telemetry/`. Envio remoto so acontece quando
voce configura `agentx telemetry enable --endpoint <url> --token <token>` ou
quando o pacote foi montado pelo mantenedor com defaults privados. `disable`
bloqueia esses defaults para aquela instalacao. O dashboard escreve
`.opencode/generated/agentx-telemetry-status.json`, sem token.

O envio remoto e action-first: `check` limpo continua no historico local e no
`preview`, mas nao entra no email/digest. `failed`,
`completed_with_warnings`, warnings/errors e updates que exigem restart sao
enviados. Para depurar o canal remoto com checks limpos, use
`agentx telemetry send --since 7d --include-pass`.

Para receber emails como no Medical Notes Workbench, rode
`agentx telemetry setup-email`. Ele usa o Wrangler logado na maquina, cria/sube um
Cloudflare Worker, coloca os secrets no Worker, configura Resend e grava um
`telemetry.defaults.json` privado dentro do pacote. Quando voce distribui esse
pacote privado, as instalacoes dos seus usuarios passam a enviar envelopes
redigidos para o seu Worker por padrao. Eles recebem apenas o endpoint e o token
de ingestao do Worker; a chave do Resend fica somente nos secrets da Cloudflare.

O arquivo `packages/agentx/telemetry.defaults.json` e ignorado
pelo Git para nao vazar o token, mas entra no zip de release quando existe.
Use `agentx telemetry setup-email --no-distribution-defaults` se quiser configurar
so a sua maquina sem autoativar builds privados.

Para releases montadas pelo GitHub Actions, grave esse mesmo JSON no secret
`OGB_TELEMETRY_DEFAULTS_JSON`. O workflow restaura o arquivo antes de criar o
zip, sem mostrar o token nos logs.

## Estrutura do pacote

```text
agentx/
  README.md
  packages/
    agentx/
      src/
      schemas/
      telemetry-email-worker/
  scripts/
  docs/
    archive/
  adrs/
  checklists/
  examples/
    gemini/
  artifacts/
    scripts/       # wrappers legados para self-update de versões antigas
  .github/
    workflows/
```

## Atenção

O bridge ja e funcional, mas ainda esta em evolucao. Antes de distribuir para
terceiros, rode:

```bash
npm --prefix packages/agentx test
npm --prefix packages/agentx run build
agentx validate
agentx security-check
agentx bridge
```
