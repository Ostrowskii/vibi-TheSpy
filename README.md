# The Spy

Projeto web multiplayer de cartas feito em TypeScript sem framework, usando
`vibinet` para sincronizar a sala e pensado para publicacao estatica no GitHub
Pages.

## Scripts

```bash
npm install
npm run build
```

O build gera `assets/app.js`, que e o bundle referenciado pelo `index.html` na
raiz.

## Modos

- `vs bot`: partida local usando a mesma regra de jogo.
- `multiplayer`: sala online com `usuario` e `sala` obrigatorios.

## Regras resumidas

- Sao 4 rodadas.
- Na 1 e 3, `p1` joga como informante do governo.
- Na 2 e 4, `p1` joga como comandante espiao.
- `agent + false file` = `0 x 0`, segue o turno.
- `agent + true file` = `+1` para o informante do governo, termina a rodada.
- `spy + false file` = `+1` para o informante do governo, termina a rodada.
- `spy + true file` = `+5` para o comandante espiao, termina a rodada.
