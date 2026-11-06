# Arquivos de terceiros (fork Kaviski)

- `selfie_segmenter.tflite` — modelo "Selfie Segmenter" do MediaPipe (Google, licença Apache 2.0), baixado de
  `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
  (sha256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`). Usado pelo desfoque/troca de fundo da
  câmera (`../media-fx.ts`), servido pelo próprio Habblaud em vez do CDN do Google.
