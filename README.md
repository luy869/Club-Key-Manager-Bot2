# Club-Key-Manager-Bot2
部室の鍵を管理するボット. ボイスチャンネルを使わずに実装した.

## 使い方
docker上で動かせます. dockerをサーバに入れとくとセットアップが楽です.

1. githubからプロジェクトファイルをクローン/ダウンロードする.
2. Dockerfileがあるディレクトリまで移動する.

起動や停止はdockerの使い方に準じます.

3. イメージを作ります.
   docker build . -t "イメージ名(何でも良い?)"
4. イメージからコンテナを実行します. 
   docker run -d "イメージ名"
5. コンテナを停止させます.
   docker stop
   
## 設定ファイル
src内のsetting.jsonが設定ファイルです. setting.json.sampleはサンプルファイルです.
 - LogChannel : Discordで記録を行うチャンネルのIDを書きます.
 - Token : DiscordBotのトークンをここに書きます.
 - ModeConsole : trueかfalseを書きます.falseは部室の鍵用でtrueは操作卓用です.開けました/閉めましたメッセージがあるか無いかが異なります.
 - Slack
     - Use : trueかfalseを書きます.slackにメッセージを送るかどうかが決まります(trueで送信する).
     - WebhookUrl : slackのincommingwebhookを使っているのでここにそれのURLを書きます.Useがfalseなら書かなくても大丈夫そう?
