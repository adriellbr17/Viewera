# Integração de mídia nativa — contrato proposto

Este documento descreve trabalho futuro. O único consumidor de frames WGC implementado é o diagnóstico de um frame. Não há classes vazias de encoder para sugerir suporte inexistente.

## Fronteiras

A UI deve solicitar iniciar/parar, fonte, áudio, bitrate, resolução e FPS. Rust deve possuir os recursos de captura, encoder e transporte. Somente eventos pequenos de estado/estatísticas podem atravessar IPC. Não transportar BGRA, JPEG/base64 ou NALs por eventos Tauri.

A captura entrega uma textura D3D11 com dimensões e timestamp monotônico. O encoder toma uma referência válida durante seu processamento; callbacks WGC não devem guardar referências emprestadas ao frame depois do retorno. A fila deve ser limitada a 1–2 frames: descartar o mais antigo antes de codificar se o consumidor atrasar. Não bloquear a captura esperando um receptor lento. Redimensionamento exige recriar recursos de conversão/encoding e enviar novo keyframe.

O encoder entrega uma unidade de acesso H.264 completa, timestamp/duração e flag de keyframe. O transporte nativo cuida da fragmentação RTP, relógio de vídeo de 90 kHz, negociação SDP e RTCP. Não enviar MP4 sobre WebSocket. Ao descartar dados, descartar frames brutos antes da codificação; descartar arbitrariamente frames P pode quebrar referências do decoder.

## H.264 por hardware

Começar com descoberta real dos dispositivos e encoders; seleção automática com opção de override de diagnóstico. Adaptadores previstos: NVIDIA NVENC, AMD AMF e Intel Quick Sync. Avaliar primeiro os encoders de hardware do Media Foundation para reduzir integrações específicas; o suporte e o controle oferecidos devem ser medidos por GPU/driver. Registrar encoder e adaptador efetivamente usados. Falta de suporte deve produzir erro claro ou fallback de software explicitamente informado.

Perfil inicial desejado: saída SDR NV12 até 1920×1080, 60 FPS, 8 Mbps ajustáveis (4–12), sem B-frames e sem lookahead, GOP inicial de 2 s e keyframe por PLI/entrada de receptor. Negociar profile-level-id e packetization-mode compatíveis com o receptor. O perfil/nível H.264 deve suportar a resolução e taxa escolhidas; não fixar um nível baixo incompatível com 1080p60. Capturas HDR precisam de conversão de cor/tone mapping, não interpretação direta como SDR.

Manter texturas na mesma GPU sempre que possível e medir cópias entre GPUs. Não prometer zero-copy antes de validar a combinação WGC/conversão/encoder. Um encode compartilhado entre peers exige política de qualidade para o receptor mais lento; começar documentando esse teto e evoluir para camadas/SFU quando necessário.

## Áudio

WASAPI loopback para áudio do sistema, conversão para Opus e sincronização por timestamps monotônicos alinhados ao relógio do vídeo. Tratar troca/desconexão do dispositivo e desvio de relógio; nenhuma dessas rotinas está implementada. O checkbox atual controla apenas a solicitação de áudio ao navegador.

## Transporte e SFU

A UI usa `PeerTransport` com `publish`, `receive`, `remove`, `close` e `stats`. Não conhece internals de RTCPeerConnection. A versão nativa precisará de comandos/eventos de controle equivalentes; o vídeo nativo não pode simplesmente ser conectado a uma MediaStream do WebView por IPC. Escolher biblioteca WebRTC nativa com H.264 e RTCP suportados, fechar o fluxo ponta a ponta e só então ligar a UI ao novo backend.

Para SFU: preservar sala/membros, substituir a publicação por uma sessão com o servidor de mídia e adaptar as assinaturas dos receptores. O protocolo atual de ofertas direcionadas é suficiente apenas para P2P; não é um protocolo universal de SFU. Autenticação, autorização de publicação/assinatura, TURN, limites e reconexão passam a ser requisitos do serviço.

## Critério para integrar

Uma GPU real deve capturar, codificar e entregar H.264 a um receptor, honrar parada e queda de conexão, liberar recursos e reportar métricas antes de habilitar o botão nativo de transmissão. Depois validar NVIDIA, AMD e Intel separadamente. O projeto atual não permite selecionar um backend ainda inexistente.

## Sala com múltiplos transmissores

Limite atual: 10 participantes e 3 publicações simultâneas, uma por participante. O servidor autoriza cada publicação com streamId único; SDP e ICE carregam esse identificador. Cada transmissão possui suas próprias conexões e parar uma não fecha as demais. Somente o dono da publicação envia ofertas ou a encerra. A sala permanece até o último membro sair. Preservar essas regras na integração nativa e impor os limites também na futura SFU.

