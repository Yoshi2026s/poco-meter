# E帯の画像読取用ファイル（第三者ソフトウェア）

E帯ページの画像読取（OCR）は、次のファイルをこのサイトから配信して使います。外部の配信元（CDN）は使いません。
取得したバイト列のまま置いており、`tests/ocr-self-host.mjs` が SHA-256 を照合します（中身を変えるとテストが落ちます）。

| ファイル | 出どころ | ライセンス | SHA-256（base64） |
|---|---|---|---|
| tesseract.min.js | npm tesseract.js@6.0.1（dist） | Apache-2.0 | EP/3hIQGd1nEMCigKnLXbQuQ6xcwK7I7WKnsVBC8kos= |
| worker.min.js | npm tesseract.js@6.0.1（dist） | Apache-2.0 | OGRVmQQyOcDrbbCKZQSpLc3CkiAFNfPpM5zXfERDuEI= |
| tesseract-core-lstm.wasm.js | npm tesseract.js-core@6.0.0 | Apache-2.0 | d1o1328q4QDgJglEPmvVyvzQeYPdYXVFTKSkMqdzBoc= |
| tesseract-core-simd-lstm.wasm.js | npm tesseract.js-core@6.0.0 | Apache-2.0 | nXxD+yBtyfSEdSKLRr81+Ij6nmJZ2i5n1adcdwSfLcc= |
| jpn.traineddata.gz | tessdata.projectnaptha.com/4.0.0_best（tesseract-ocr/tessdata_best の日本語データ） | Apache-2.0 | W3ZCFWiWzNs5rqg9tiON2FyPuhTg3ZKtfbKQmL8Ofd0= |

- 2026/11/20 取得。npm の4ファイルは jsDelivr が公開するハッシュ（tesseract.min.js は従来の SRI sha384）と一致することを確認した。言語データは配信元がハッシュを公開していないため、取得時の値を固定した。
- ライセンス本文：[LICENSE-Apache-2.0.txt](LICENSE-Apache-2.0.txt)。著作権は各プロジェクト（tesseract.js、Tesseract OCR）の作者に帰属し、リポジトリの LICENSE（利用条件）の対象外。
- 版を上げるときは、新しいファイルの取得・ハッシュの確認・この表とテストの更新・実ブラウザでの読取確認をそろえて行う。
