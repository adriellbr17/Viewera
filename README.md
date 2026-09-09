# Amigos Tela — protótipo Windows

App pequeno para compartilhar uma tela ou janela com até nove amigos. Tauri 2 + Rust no desktop, interface HTML/CSS/JS sem framework e signaling WebSocket em Node, preparado para hospedagem HTTPS/WSS.

**Entrega inicial:** interface e signaling funcional, implementação WebRTC de teste via captura do navegador e um teste de captura nativa Windows Graphics Capture em Rust. **Ainda não é um transmissor nativo WGC → H.264 → WebRTC completo.** 1080p60 é a configuração desejada, não uma medição ou garantia. NVENC/AMF/Quick Sync estão planejados no contrato de mídia; nenhum SDK de encoder é fingido ou selecionado pela interface.

**Amigos em outras cidades:** consulte [Publicar pela internet](docs/internet.md). O código já inclui WSS, chave do grupo e integração de TURN temporário; a publicação depende de contas/credenciais e ainda não foi realizada.

## O que existe

| Recurso | Estado |
|---|---|
| Criar/entrar em sala por código de 8 caracteres | Implementado e testado |
| Até 10 participantes no total | Imposto pelo servidor e testado |
| Até 3 transmissores simultâneos, qualquer participante | Limite e troca testados |
| Lista de participantes, saída e encerramento | Implementado e testado |
| Transporte WebRTC P2P em estrela | Código implementado; vídeo real ainda não validado neste ambiente |
| H.264, até 1920×1080 / 60 FPS, 4/8/12 Mbps por receptor | Restrições e negociação implementadas; dependem de runtime, fonte, GPU e rede |
| Áudio opcional | `getDisplayMedia`; depende da fonte e do seletor do navegador; WASAPI nativo pendente |
| Windows Graphics Capture | Comando Rust que recebe um frame e encerra; ainda não compilado aqui |
| NVENC / AMF / Quick Sync | Contrato e plano de integração; implementação pendente |
| Internet / TURN | Integração e configuração de hospedagem implementadas; publicação e teste real pendentes |
| SFU / instalador | Próximas etapas |

## Executar agora no Windows

Instale Node.js 22 ou posterior. Abra PowerShell nesta pasta:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run dev
```

Abra **http://127.0.0.1:8787** no Microsoft Edge atualizado. Abra outra aba no mesmo endereço. Na primeira, crie a sala; na segunda, entre pelo código. Qualquer participante pode compartilhar, até 3 ao mesmo tempo. Quem não compartilha pode apenas assistir. As telas aparecem lado a lado e cada vídeo tem controles de áudio e tela cheia. Clique em **Compartilhar tela / janela** e escolha uma fonte no seletor. Para áudio, marque a opção antes de compartilhar e autorize o áudio no seletor quando oferecido. A opção não garante áudio: o status informa se uma faixa foi obtida.

Uma fonte de teste com movimento facilita observar FPS. O rodapé do vídeo mostra codec, dimensões e FPS quando o runtime disponibiliza as estatísticas. Tela estática pode gerar menos frames. Caso o áudio não comece automaticamente, use o controle de reprodução. Para trocar de fonte ou bitrate, pare e compartilhe novamente.

## Rodar o app Tauri

Pré-requisitos adicionais:

- Windows 10 atualizado ou Windows 11; validar WGC nos dispositivos de destino.
- Visual Studio Build Tools com **Desenvolvimento para desktop com C++** e Windows SDK.
- Rust estável com toolchain MSVC (`rustup default stable-msvc`).
- Microsoft Edge WebView2 Evergreen Runtime.

Com `npm.cmd run dev` ainda aberto, em um segundo terminal nesta pasta:

```powershell
npm.cmd run desktop
```

Em **Captura nativa e próximos passos**, clique **Testar captura WGC**. Escolha uma tela/janela. O Rust espera até 10 segundos por um frame depois da seleção, mostra suas dimensões e encerra a captura. Não grava arquivos, não envia pixels por IPC e não transmite esse frame. Cancele no seletor para desistir.

O compartilhamento WebRTC no desktop depende de suporte a `getDisplayMedia` no WebView2 instalado. Se indisponível, a interface orienta o teste no Edge. O módulo WGC existe justamente para eliminar essa dependência na próxima integração; não há fallback silencioso que se apresente como WGC.

Gerar o executável após instalar os pré-requisitos:

```powershell
npm.cmd run build
```

Saída esperada: `src-tauri/target/release/amigos-tela.exe`. A interface é embutida no executável; o servidor de salas continua sendo um processo separado. Não há instalador nem assinatura nesta entrega. O primeiro build Rust precisa de internet para baixar crates. `Cargo.lock` será gerado no primeiro build; versioná-lo após validar. `package-lock.json` já acompanha o projeto.

## Rede: teste local e publicação

No mesmo PC, use http://127.0.0.1:8787 para desenvolver. Sem credenciais de TURN, o modo local permanece disponível para testes.

Para seus amigos em outras redes, siga [o guia de publicação](docs/internet.md). O servidor hospedado deve ter HTTPS/WSS, chave do grupo e TURN configurados. Depois disso, seus amigos acessam a mesma URL HTTPS no Edge, sem instalar Node e sem depender do seu PC. O navegador reconhece o servidor automaticamente. Somente no aplicativo Tauri o endereço remoto é informado em **Configuração da conexão**.

O cliente rejeita ws:// fora de localhost. O processo Node recebe HTTP internamente atrás do proxy TLS da hospedagem; publicar apenas essa porta HTTP não basta. Não há um serviço online ativo nesta entrega.

## Arquitetura

```text
AGORA
Tauri / interface HTML ── JSON de controle ── signaling Node + ws
        │                                  salas, membros, SDP, ICE
        ├── getDisplayMedia → RTCPeerConnection → até 9 receptores por transmissão
        │                         H.264 preferido/exigido no envio
        └── comando Rust → seletor WGC → um frame → resultado textual

PRÓXIMA INTEGRAÇÃO NATIVA (ainda não implementada)
WGC → textura D3D11 → conversão/escala NV12 → encoder H.264 por GPU
                                                │
WASAPI loopback → Opus ──────────────────────────┤
                                                ▼
                                    WebRTC nativo / DTLS-SRTP
                                                │
                                    nove pares → futura SFU
```

- `web/app.js`: estado da sala, controles, captura provisória e limpeza.
- `web/transport.js`: conexões WebRTC, SDP, fila ICE e métricas. Uma conexão por par transmissão/receptor; o dono de cada transmissão inicia sua oferta. Um streamId novo por publicação separa ofertas simultâneas e descarta sinais atrasados.
- `server/deployment.js`: validação do ambiente e obtenção/cache de credenciais temporárias Twilio STUN/TURN.
- `server/index.js`: arquivos da interface e signaling. Não recebe vídeo/áudio. Valida associação à sala e destino; o cliente não escolhe seu próprio identificador.
- `src-tauri/src/main.rs`: janela desktop e comando de diagnóstico.
- `src-tauri/src/capture.rs`: seletor e callback WGC, sem copiar frames para JavaScript.
- `test/signaling.test.js`: teste de integração com conexões WebSocket reais.
- `docs/media.md`: contrato proposto para encoders nativos e migração para SFU.

A sala pertence ao grupo: o criador não tem papel especial depois de criar. Qualquer participante pode iniciar uma transmissão, com limite de uma por pessoa e três na sala. A quarta tentativa é recusada atomicamente pelo servidor. Parar ou sair remove apenas a transmissão dessa pessoa. A sala só desaparece quando o último participante sai. Um participante pode sair e entrar novamente. As salas desaparecem quando o servidor reinicia. Não há reconexão automática: uma falha de rede pede nova entrada. A UI e o protocolo usam identificadores de participantes, não endereços de GPU ou handles de captura, permitindo substituir a implementação de mídia.

Por transmissor, com nove receptores a 8 Mbps, o upload de vídeo pode se aproximar de 72 Mbps, além de áudio e overhead. O navegador pode usar mais de um encoder; esta implementação não promete codificar uma única vez. Na SFU, o transmissor poderá publicar uma vez, mas será necessário integrar o protocolo e o controle de banda da SFU escolhida.

## Verificação desta entrega

Executado neste ambiente:

- Verificação de sintaxe dos arquivos JavaScript.
- Testes de chave do grupo, configuração obrigatória em produção, emissão e renovação de ICE, e falha segura do provedor TURN (simulado).
- `npm.cmd test`: teste de integração aprovado, incluindo 10 participantes, disputa de 4 pessoas por 3 vagas de transmissão, ofertas em duas direções, isolamento, origem inválida, JSON inválido, saída, reentrada e encerramento apenas quando a sala fica vazia.
- Interface aberta no navegador; criação de sala e entrada de um segundo participante confirmadas visualmente.

Não executado: build Rust/Tauri (Rust/Cargo ausentes), teste WGC em hardware, vídeo/áudio ponta a ponta, teste entre dois PCs e medição de latência/CPU/GPU. Nenhum `.exe` pré-compilado acompanha esta entrega.

Antes de considerar 1080p60 validado: transmitir fonte com movimento entre dois PCs durante 10 minutos; confirmar H.264, resolução/FPS recebidos, estabilidade com 9 receptores, parada da captura pelo Windows, uso de CPU/GPU e latência medida com relógio visual. Repetir com áudio, janela fechada, cancelamento de seleção, queda de rede, transmissor saindo e criador saindo. Não usar RTT como equivalente a latência de imagem.

## Referências técnicas

- [Pré-requisitos oficiais do Tauri](https://v2.tauri.app/start/prerequisites/)
- [Configuração Tauri 2](https://v2.tauri.app/reference/config/)
- [Windows Capture 2.0.1 / WGC](https://docs.rs/windows-capture/2.0.1/windows_capture/)
- [Controle da sessão WGC](https://docs.rs/windows-capture/2.0.1/windows_capture/capture/struct.CaptureControl.html)
- [Captura com getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

## Três telas simultâneas

Quem entra recebe automaticamente as transmissões ativas e pode controlar som/reprodução de cada uma. **Parar minha transmissão** libera uma vaga e mantém as outras telas. Para testar, entre com quatro participantes e compartilhe em três deles; o quarto verá o limite preenchido. Ao parar uma, ele poderá compartilhar.

Em P2P, três transmissores podem criar até 27 conexões de mídia na sala de 10 pessoas. A 8 Mbps por tela, um espectador de três telas pode receber cerca de 24 Mbps de vídeo; cada transmissor continua podendo enviar perto de 72 Mbps. Esses números são estimativas aritméticas, não benchmarks. A capacidade de sala/transmissões foi testada no signaling; três vídeos 1080p60 simultâneos ainda precisam de validação real.

