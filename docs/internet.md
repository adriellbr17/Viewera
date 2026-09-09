# Publicar para amigos em qualquer cidade

## Estado atual

O código está preparado para hospedagem HTTPS/WSS e TURN gerenciado. **Não existe URL pública ativa nesta entrega.** Nenhuma conta foi criada, nenhum serviço foi contratado e nenhuma credencial real foi usada. Os testes usam um provedor TURN simulado; ainda é necessário publicar e verificar em duas redes diferentes.

Depois de publicado, seus amigos abrem o mesmo link HTTPS no Edge, digitam a chave privada do grupo e criam/entram em uma sala por código. Não precisam instalar Node, abrir portas no roteador nem manter o PC do autor ligado. Permanecem os limites de 10 pessoas e 3 transmissões simultâneas. Quem transmite mantém seu próprio PC ligado.

## Serviços a configurar

1. Uma conta de hospedagem com processo Node e WebSocket persistente. O caminho documentado aqui é **Render Web Service**, que fornece endereço HTTPS e suporte a WSS.
2. Uma conta **Twilio Network Traversal Service**, com STUN/TURN ativo para gerar credenciais temporárias. Verifique no painel as exigências da conta, limites e custos de tráfego antes de ativar.

Hospedagem de arquivos estáticos sozinha não roda o servidor de salas. TURN não é a SFU: resolve conexões sem caminho direto, mas o transmissor ainda envia uma cópia por receptor. A cobrança de relay depende do tráfego; não há promessa de uso gratuito. Configure alertas/limites de uso no provedor.

## Preparar o projeto

Suba o conteúdo desta pasta em um repositório privado na sua conta GitHub. Não envie `node_modules`, `src-tauri/target`, `.env` ou credenciais. O arquivo `.env.example` contém somente nomes e exemplos e pode acompanhar o repositório.

Na Render, crie um **Web Service** a partir desse repositório:

| Campo | Valor |
|---|---|
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/healthz` |
| Número de instâncias | **1** |
| Root directory | Pasta que contém `package.json` (vazia se for a raiz do repositório) |

Escolha o plano e região no painel de acordo com disponibilidade, custo e proximidade do grupo. Instâncias que dormem podem causar espera na primeira conexão. Não use várias instâncias: salas estão em memória e não são compartilhadas entre processos. Um reinício/deploy encerra as salas.

O Dockerfile é uma alternativa para hospedagens compatíveis com contêiner. O contêiner também exige HTTPS/WSS no proxy de entrada; ele não emite certificados por conta própria. A imagem não inclui Rust porque hospeda somente a interface e o signaling.

## Variáveis privadas do serviço

Configure no painel da hospedagem, nunca no código nem no chat:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PUBLIC_ORIGIN` | URL HTTPS da Render, sem `/` no final, por exemplo `https://nome-do-servico.onrender.com` |
| `ACCESS_KEY` | Chave aleatória de 24 a 256 caracteres, compartilhada somente com os amigos |
| `TWILIO_ACCOUNT_SID` | SID da conta Twilio com NTS ativo |
| `TWILIO_AUTH_TOKEN` | Auth Token privado da conta Twilio |
| `ICE_RELAY_ONLY` | `false` normalmente; `true` para testar TURN forçado |

O endereço público não precisa de domínio comprado. Use a URL atribuída pela hospedagem. A Render fornece `PORT`; o processo respeita essa porta e escuta em `0.0.0.0` no modo de produção. Sem as configurações obrigatórias, o processo de produção recusa iniciar. É normal o primeiro deploy falhar enquanto as variáveis ainda estão incompletas; configure e publique novamente.

Uma maneira local de gerar a chave do grupo, na pasta do projeto:

```powershell
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

Essa chave permite entrar/criar salas e obter acesso temporário ao relay. Compartilhe somente com o grupo. A chave do grupo **não é** o Auth Token Twilio: esse último jamais vai para os amigos. Para revogar o acesso do grupo, troque `ACCESS_KEY` e reinicie o serviço. Credenciais TURN já emitidas expiram separadamente.

## Teste real pela internet

1. Abra a URL HTTPS publicada no Edge em dois PCs conectados a redes diferentes (por exemplo internet fixa e hotspot de celular).
2. Nos dois, informe a mesma chave do grupo. Crie uma sala em um e entre com o código no outro.
3. Compartilhe uma janela e confirme imagem e áudio. O endereço de signaling é reconhecido automaticamente; não se usa localhost no link online.
4. Configure `ICE_RELAY_ONLY=true`, publique/reinicie e entre novamente. Compartilhe outra vez. O rodapé deve indicar **TURN**: isso verifica que o relay realmente funciona. Só validar entrada na sala não comprova vídeo pela internet.
5. Volte `ICE_RELAY_ONLY=false`, reinicie e teste com os 10 participantes e até 3 telas.
6. Pare uma transmissão, feche um transmissor, saia com o criador e verifique que as demais continuam. Em queda de conexão, entre novamente.

Credenciais TURN emitidas duram até 24 horas e são atualizadas no app a cada 10 minutos para novas conexões. Atualizar a configuração não renegocia uma conexão já aberta: para sessões que ultrapassem 24 horas, sair e entrar novamente. Validar sessões longas, troca de rede e comportamento do provedor antes de distribuir amplamente.

## Aplicativo Windows

O mesmo backend aceita o Tauri. Em **Configuração da conexão**, use `wss://nome-do-servico.onrender.com/signal` e informe a chave do grupo. A versão desktop continua dependendo do build Rust e da captura suportada no WebView2; não há instalador validado nesta entrega. Para o primeiro teste remoto, use o link HTTPS no Edge.

## O que protege o serviço

A chave do grupo é validada antes de entrar/criar sala ou obter TURN. SDP/ICE são roteados somente entre membros da mesma sala e da transmissão correspondente. Credenciais permanentes ficam no backend. Há limite global de 100 tentativas de entrada/criação por minuto, filas limitadas, máximo de participantes/publicações e bloqueio de origens desconhecidas. Isso atende ao protótipo privado de um grupo, não substitui contas individuais, moderação ou proteção de infraestrutura para um serviço público aberto.

## Referências

- [Hospedar Node na Render](https://render.com/docs/deploy-node-express-app)
- [WebSockets na Render](https://render.com/docs/websocket)
- [Credenciais temporárias Twilio STUN/TURN](https://www.twilio.com/docs/stun-turn/api)

