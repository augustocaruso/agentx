# Native Capability Resolution Design

## Contexto

O OGB hoje funciona principalmente como uma ponte Gemini-first para OpenCode: inventaria recursos do ecossistema Gemini, expande contexto, projeta arquivos compatíveis e mantém estado gerenciado para evitar sobrescrever trabalho manual. Esse modelo continua válido, mas fica incompleto quando o destino já oferece uma instalação nativa melhor para a mesma entidade.

Exemplo concreto: uma extensão Gemini pode trazer arquivos do Superpowers e o OGB consegue projetá-los como compatibilidade. Porém o OpenCode já tem um caminho nativo para Superpowers via plugin. Nesse caso, o comportamento preferido não deve ser clonar/copiar os arquivos; deve ser instalar e validar o plugin nativo. A projeção gerada pelo OGB deve existir apenas como fallback confiável.

O mesmo contrato precisa valer para Antigravity CLI. Hoje os plugins nativos ainda são novos ou inexistentes para várias entidades, então ports provisórios podem ser necessários. Quando surgir uma instalação nativa conhecida e validável, o OGB deve detectá-la, remover o port gerenciado antigo e privilegiar a instalação nativa.

## Objetivo

Adicionar uma camada de resolução antes da projeção:

1. Identificar a entidade canônica detectada pelo inventário.
2. Descobrir se o destino possui uma instalação nativa conhecida.
3. Instalar automaticamente a alternativa nativa quando ela for conhecida e validável.
4. Validar a instalação com smoke tests reais.
5. Usar projeção compatível somente quando não houver nativo válido.
6. Remover ports gerenciados antigos quando um nativo válido passar a existir.

## Fora de Escopo

- Discovery remoto dinâmico por marketplace ou busca web no fluxo normal.
- Instalação de entidades desconhecidas por inferência heurística.
- Migração inversa OpenCode para Gemini ou Antigravity como comportamento padrão.
- Remoção de arquivos que não foram gerenciados pelo OGB.
- Troca automática de fonte canônica sem modo/contrato explícito.

## Modelo Mental

O fluxo passa a ter uma etapa a mais:

```text
inventario -> resolver nativo -> decisao -> execucao -> validacao -> estado
```

O resolvedor responde uma pergunta simples: "Para esta entidade e este destino, existe um caminho nativo melhor do que gerar compatibilidade?"

Se sim, o OGB instala/configura o nativo e valida. Se a validação passar, o OGB remove apenas ports antigos que ele mesmo gerenciou. Se a validação falhar, o OGB mantém ou gera o port compatível.

## Decisões Possíveis

### `use_existing_native`

O nativo já está instalado e passou no smoke. O OGB não projeta compatibilidade para essa entidade e remove ports gerenciados obsoletos.

### `install_native`

O OGB conhece uma instalação nativa para a entidade, ela é permitida pelo modo atual e ainda não está ativa. O OGB instala/configura, roda smoke e só considera concluído se o smoke passar.

### `fallback_compat`

Não há nativo conhecido, ou o nativo conhecido falhou no smoke. O OGB segue o caminho atual de gerar compatibilidade, com estado gerenciado, hashes, conflitos e validação.

### `remove_managed_port`

O OGB detectou que um port antigo era gerenciado por ele e que agora existe nativo válido. O port é removido com as mesmas proteções de stale managed files já usadas pelo sync.

### `blocked`

Existe conflito manual, instalação nativa suspeita, versão incompatível, ou remoção exigiria apagar arquivos não gerenciados. O OGB não mexe e reporta uma ação clara no doctor/check.

## Registry De Capacidades

Criar um registry interno versionado, inicialmente estático, com entradas por entidade e destino.

Campos mínimos:

```text
entity_id
target
native_status
native_install_spec
native_config_patch
smoke_checks
compatibility_port
managed_port_paths
deprecation_policy
```

### `entity_id`

Identificador estável da entidade, por exemplo `superpowers`.

### `target`

Destino da instalação: `opencode`, `antigravity-cli`, `antigravity-legacy`, ou futuros destinos.

### `native_status`

Valores iniciais:

- `available`: o OGB conhece instalação nativa e pode validar.
- `not_available`: ainda não existe instalação nativa conhecida.
- `experimental`: existe sinal de nativo, mas não deve ser ativado automaticamente.
- `blocked`: existe nativo conhecido, mas uma incompatibilidade conhecida impede uso automático.

### `native_install_spec`

Como ativar o nativo. Para OpenCode/Superpowers, a forma inicial é adicionar o plugin documentado ao `plugin` array do `opencode.json`:

```text
superpowers@git+https://github.com/obra/superpowers.git
```

O OGB deve tratar isso como configuração nativa do destino, não como arquivo projetado de compatibilidade.

### `smoke_checks`

Conjunto de verificações que provam que o nativo está funcionando. Para Superpowers/OpenCode, a validação mínima deve provar:

- O plugin está presente na config resolvida do OpenCode.
- O OpenCode consegue carregar o plugin sem erro visível.
- As skills do Superpowers aparecem no mecanismo de skills do OpenCode, quando o runtime oferecer essa inspeção.
- Se o mecanismo de skills não puder ser inspecionado de modo confiável, o resultado deve virar `fallback_compat` ou `blocked`, não sucesso silencioso.

### `compatibility_port`

Define o fallback atual: copiar/projetar skills, commands, MCPs, hooks ou agents para paths OpenCode/Antigravity, com hashes e sync state.

### `managed_port_paths`

Lista de prefixes que o OGB pode remover quando o nativo passar no smoke. Nunca remover arquivos fora do sync state ou sem marker/hashes compatíveis.

## Superpowers Para OpenCode

Contrato inicial:

- Entidade: `superpowers`.
- Destino: `opencode`.
- Nativo preferido: plugin OpenCode `superpowers@git+https://github.com/obra/superpowers.git`.
- Fallback: port gerenciado de skills/arquivos quando o plugin nativo não puder ser validado.

Motivo: o upstream Superpowers documenta uma integração nativa para OpenCode via plugin. Também há histórico de incompatibilidade em que o plugin carrega bootstrap, mas a descoberta de skills falha. Por isso, "plugin está configurado" não basta; o smoke precisa provar funcionalidade.

## Antigravity CLI

Contrato inicial:

- Entidades conhecidas podem continuar usando `compatibility_port` enquanto não houver plugin nativo conhecido e validável.
- O registry deve permitir adicionar, no futuro, uma entrada `available` para `target=antigravity-cli`.
- Quando essa entrada existir e o smoke passar, o OGB deve remover ports gerenciados antigos e privilegiar a instalação nativa.

Esse desenho evita tratar o port provisório como permanente. O port é uma ponte, não a fonte canônica final.

## UX Pública

O fluxo normal deve continuar "just works":

- `ogb install`, `ogb setup-ux`, `ogb check` e `ogb sync` podem instalar nativos conhecidos automaticamente quando o modo permitir.
- O usuário não precisa saber sobre registry, hash, smoke ou fallback.
- Em caso de falha, a mensagem pública deve dizer em linguagem simples: "A instalação nativa não pôde ser confirmada; o OGB manteve a compatibilidade gerada."
- Detalhes técnicos ficam no doctor/check avançado e nos JSONs gerados.

## Segurança E Confiabilidade

- Instalar nativo automaticamente só é permitido para entradas conhecidas no registry.
- Entradas precisam ter origem fixa e explícita.
- O OGB não deve executar discovery remoto dinâmico no caminho normal.
- Smokes precisam ter timeout e não podem depender de prompts interativos.
- Falha de smoke nunca deve apagar fallback funcional.
- Remoção automática só vale para arquivos gerenciados pelo OGB.
- Manual edits continuam protegidos por hash/state/backup.

## Mudanças Arquiteturais

Adicionar um módulo novo, por exemplo:

```text
packages/ogb/src/native-capability-resolver.ts
packages/ogb/src/native-capability-registry.ts
packages/ogb/src/native-capability-resolver.test.ts
```

O `sync` e o `setup-ux` devem consultar o resolver antes de projetar uma entidade que tenha entrada no registry.

O `doctor` deve reportar:

- nativo ativo e validado;
- nativo conhecido mas não instalado;
- nativo instalado mas falhando no smoke;
- fallback compatível em uso;
- port antigo removível;
- conflito manual bloqueando remoção.

## Fluxo De Dados

```text
Inventory entity
  -> NativeCapabilityRegistry lookup
  -> Environment probe
  -> Native install/configure if allowed
  -> Smoke validation
  -> Compatibility fallback or native adoption
  -> Sync state update
  -> Doctor/check report
```

## Critérios De Aceitação

- Superpowers/OpenCode usa plugin nativo quando o smoke passa.
- Se o plugin nativo falhar, o OGB mantém/projeta fallback compatível.
- Ports gerenciados antigos são removidos somente após nativo validado.
- Ports não gerenciados ou editados manualmente são preservados e reportados.
- Antigravity CLI pode permanecer em port provisório hoje, mas o registry permite migrar para nativo depois sem mudar a arquitetura.
- `doctor` e `check` explicam a decisão em linguagem simples.
- Testes cobrem nativo válido, nativo ausente, nativo falhando, port gerenciado removido e conflito manual preservado.

## Referências

- Superpowers OpenCode docs: https://github.com/obra/superpowers/blob/main/docs/README.opencode.md
- Superpowers OpenCode issue sobre validação real de skills: https://github.com/obra/superpowers/issues/1087
- Antigravity CLI transition context: https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/
