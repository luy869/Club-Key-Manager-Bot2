# Club-Key-Manager-Bot2
部室の鍵を管理するボット. ボイスチャンネルを使わずに実装した.

## 使い方
docker上で動かせます. dockerをサーバに入れとくとセットアップが楽です.
Discord上でボタンをポチポチ押すとメッセージを送れます.

1. githubからプロジェクトファイルをクローン/ダウンロードする.
2. Dockerfileがあるディレクトリまで移動する.

起動や停止はdockerの使い方に準じます.

3. イメージを作ります.
   docker build . -t "イメージ名(何でも良い?)"
4. イメージからコンテナを実行します. 
   docker run -d "イメージ名"
5. コンテナを停止させます.
   docker stop "コンテナ名"
   
## 設定ファイル
src内のsetting.jsonが設定ファイルです. setting.json.sampleはサンプルファイルです.
 - LogChannel : Discordで記録を行うチャンネルのIDを書きます.
 - Token : DiscordBotのトークンをここに書きます.
 - ModeConsole : trueかfalseを書きます.falseは部室の鍵用でtrueは操作卓用です.開けました/閉めましたメッセージがあるか無いかが異なります.
 - ReminderTimeMinutes : 鍵を借りてから返却リマインダーを送るまでの時間（分）を指定します. デフォルトは60分です.
 - checkHour : 定時チェックの時刻（時）を指定します. デフォルトは20時です.
 - checkMinute : 定時チェックの時刻（分）を指定します. デフォルトは0分です.
 <!-- - Slack
     - Use : trueかfalseを書きます.slackにメッセージを送るかどうかが決まります(trueで送信する).
     - WebhookUrl : slackのincommingwebhookを使っているのでここにそれのURLを書きます.Useがfalseなら書かなくても大丈夫そう? -->

## 機能
- ボタンUIで鍵の状態管理（借りる/開ける/閉める/返す）
- 鍵を借りたユーザーを記憶し、指定時間後に返却リマインダーを送信（メンション付き）
- 定期的なリマインダー通知（設定した間隔ごとに繰り返し通知）
- 毎日指定時刻に返却確認（デフォルト20時）
- Botのステータスで鍵の状態を表示
- スラッシュコマンドでアラーム機能をコントロール
  - `/reminder on/off` : リマインダー機能のON/OFF
  - `/scheduled-check on/off` : 定時チェック機能のON/OFF
  - `/set-reminder-time <分>` : リマインダーの間隔を変更
  - `/set-check-time <時> <分>` : 定時チェックの時刻を変更
  - `/alarm-status` : 現在のアラーム設定を表示
  - `/change-owner @ユーザー` : 鍵の持ち主を変更
<!-- - Slack連携（オプション） -->
