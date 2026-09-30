# Pedido à API — modelo único do Mapping Studio (Sysmiddle + TCL/XSLT)

**De:** layoutparser-portal · **Para:** LayoutParserApi · **Relacionados:** #267, LayoutParserApi#425 (`layout-tree`)

## Contexto

O formulário do ConnectUs (`UCMapper`) mostra duas árvores (layout de origem e de destino), com
ligações e regras penduradas no nó de destino, painel de propriedades por tipo de nó, aba de
regras e aba de transformação. O portal já replica a árvore e os vínculos a partir de
`GET .../layout-tree`, mas esse endpoint só traz `guid`, `name`, `kind` simplificado e
`cardinality`. Isso não basta para o painel de propriedades, nem para criar ou editar.

A fonte da verdade do ConnectUs é o XML autoritário (`LayoutVO`/`MapperVO`). Nosso motor trabalha
com TCL (layout TXT) e XSLT (mapeador). Queremos **uma única aba** do Mapping Studio servindo os
dois mundos, com o mesmo modelo de dados.

## Pedido 1 — leitura: `studio-model`

`GET /api/workspaces/{workspaceId}/mappings/{mapperGuid}/studio-model?engine=sysmiddle|tcl|xslt`

Devolve o mesmo formato para qualquer engine, mais `eTag` e `rawHash` do artefato de origem.

```json
{
  "artifact": {
    "engine": "sysmiddle",
    "id": "MAP_…",
    "name": "…",
    "rawHash": "…",
    "eTag": "…",
    "variantFields": ["FullXPath", "UniqueOccurrence"]
  },
  "capabilities": {
    "edit": true,
    "editableOps": ["addLink", "removeLink", "setRule", "updateNode", "rename"]
  },
  "trees": {
    "input": { "layoutRef": "LAY_…", "format": "text-positional", "rootIds": ["LIN_…"] },
    "target": { "layoutRef": "LAY_…", "format": "xml", "rootIds": ["GRT_…"] }
  },
  "nodes": {
    "FLD_…": {
      "tree": "input",
      "type": "field",
      "name": "…",
      "path": "A/B/C",
      "parentId": "LIN_…",
      "order": 3,
      "required": false,
      "display": { "text": "Nome    (-, Str_MAX)", "icon": "field" },
      "props": {
        "description": "",
        "length": 4,
        "offset": 8,
        "align": "Right",
        "trim": "All",
        "dataType": { "guid": "DAT_…", "name": "Str_MAX" },
        "initialValue": null,
        "minOccurs": null,
        "maxOccurs": null
      }
    }
  },
  "links": {
    "LKM_…": {
      "sourceId": "FLD_…",
      "targetId": "TAG_…",
      "order": 1,
      "display": { "text": "Origem_Destino", "icon": "linkMapping" },
      "opts": {
        "trim": "All",
        "truncate": false,
        "default": null,
        "allowEmpty": true,
        "notCreateGroupTagOnlyChilds": false
      },
      "iterates": false
    }
  },
  "rules": {
    "RUL_…": {
      "anchorId": "TAG_…",
      "display": { "text": "Rule_qtd", "icon": "rule" },
      "code": "…",
      "reads": ["A/B"],
      "writes": ["x/y"],
      "functions": ["Concat"],
      "prePos": false,
      "opaque": [{ "reason": "side-effect:…", "span": [120, 180] }]
    }
  },
  "diagnostics": [{ "code": "ORPHAN_LINK", "id": "LKM_…" }]
}
```

Pontos que o front precisa:

1. **`required` e `dataType`** em cada nó, para montar o texto `Nome    (±, mín, máx)` ou
   `Nome    (±, Tipo)` como no desktop. Se a API já calcula `display.text`, pode devolver pronto.
2. **`type` completo:** `line`, `field`, `repeaterGroup`, `grouper`, `groupTag`, `tag`, `attribute`,
   `choice`, `sequence`, `jsonObject` (hoje só `element|attribute|group`).
3. **Regra sem origem** é um vínculo distinto (`rules`), não uma ligação com origem vazia.
4. **Regras de TCL/XSLT:** o que não tem equivalente estruturado volta como `opaque`, com motivo.
   No TCL só existem linhas e campos; ligações e regras vêm do XSLT.
5. **Diagnósticos** já calculados: `ORPHAN_LINK`, `AMBIGUOUS_NAME_PATH`, `TARGET_HAS_LINK_AND_RULE`,
   `TARGET_HAS_MULTIPLE_LINKS`.

## Pedido 2 — escrita: operações sobre o modelo

`PATCH /api/workspaces/{workspaceId}/mappings/{mapperGuid}/studio-model` com `If-Match: <eTag>`.

```json
{
  "ops": [
    { "op": "addLink", "sourceId": "FLD_…", "targetId": "TAG_…" },
    { "op": "setRule", "targetId": "TAG_…", "code": "…" },
    { "op": "removeLink", "id": "LKM_…" },
    { "op": "updateNode", "id": "FLD_…", "props": { "length": 6 } },
    { "op": "rename", "id": "FLD_…", "name": "…", "updateRuleCode": true }
  ]
}
```

- **Salvar por patch sobre o XML/TCL/XSLT original**, sem reescrever o arquivo: o formato varia
  entre versões e não tem versão de esquema.
- **Validar no servidor** a regra de um vínculo por destino (ligação **ou** regra) e devolver
  `409`/`422` com `code` claro.
- **Renomear:** `I.`/`T.` no código das regras usam **nome**. Devolver quais regras seriam
  afetadas (`updateRuleCode: false` só avisa) em vez de quebrar em silêncio.
- **Órfãos:** não descartar ao salvar; devolver como diagnóstico.
- Resposta traz o `studio-model` atualizado e o novo `eTag`.

## Pedido 3 — TCL e XSLT no mesmo modelo

- `engine=tcl`: árvore de origem (linhas, campos, `offset` calculado pela soma dos `length`
  anteriores); sem `links`/`rules`.
- `engine=xslt`: árvore de destino, `links` e `rules`, `opaque` para o que não for estruturável.
- Criar e editar TCL/XSLT pelos mesmos `ops`, com `capabilities.editableOps` dizendo o que cada
  engine aceita.
- Esperamos que o `for-each` vire vínculo contêiner (`iterates: true`), como a ligação
  `LIN→GRT` do ConnectUs.

## Perguntas em aberto para a API

1. O `display.text` (incluindo o `±`) será calculado na API ou o front monta a partir de
   `required`/`dataType`/`minOccurs`/`maxOccurs`?
2. Critério do auto-mapeamento (`CreateAutoLinkMapping`): igualdade de nome? Queremos um
   `ops: autoLink` no futuro.
3. Como resolver `I.`/`T.` quando há irmãos com o mesmo nome (85 casos nos dados reais)?
4. A escrita entra no mesmo fluxo de rascunho/release do Mapping Studio ou edita o artefato
   direto? Precisamos de justificativa e auditoria como na edição manual (#226).

## Fora de escopo

Não trazer TXT/XML real nem segredo para o GitHub; exemplos só sintéticos.
