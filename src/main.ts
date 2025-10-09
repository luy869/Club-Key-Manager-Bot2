import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Events,
  TextChannel,
  EmbedBuilder,
  PresenceStatusData,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import fs from "fs";
import path from "path";
// import { messagingSlack, createMessage } from "./slack";

const settings = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../src/setting.json"), "utf8")
);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
}); //必要な権限を書いている

const id_log_channel = settings.LogChannel;
const token = settings.Token;

const string2boolean = (value: string | null | undefined): boolean => {
  if (!value) {
    return false;
  }
  return value.toLowerCase() === "true" || value === "1";
}; //文字列をbooleanにする.下で操作卓モードにするか決める時に使う.

const mode_console = string2boolean(settings.ModeConsole); //jsonファイルから操作卓モードにするかを決定する.

// const isUseSlack = string2boolean(settings.Slack.Use);
let reminderTimeMinutes = settings.ReminderTimeMinutes || 60; //鍵の返却リマインダー時間（分）、デフォルトは60分
let checkHour = settings.checkHour || 20; //定時チェックの時刻（時）、デフォルトは20時
let checkMinute = settings.checkMinute || 0; //定時チェックの時刻（分）、デフォルトは0分
let isReminderEnabled = true; //リマインダー機能のON/OFF
let isScheduledCheckEnabled = true; //定時チェック機能のON/OFF

type Key = "BORROW" | "OPEN" | "CLOSE" | "RETURN"; //鍵の状態の種類

let var_status: Key = "RETURN"; //鍵の状態を格納する.状態によって値が変わる.

// 借りたユーザーの情報を保存
type BorrowerInfo = {
  userId: string;
  username: string;
  channelId: string;
  timerId: ReturnType<typeof setTimeout> | null;
  borrowedAt: number; // 借りた時刻（ミリ秒）
  reminderCount: number; // リマインダー送信回数
};

let borrowerInfo: BorrowerInfo | null = null; //借りたユーザーの情報

// 定時チェックのタイマーID
let scheduledCheckTimerId: ReturnType<typeof setTimeout> | null = null;

type oper_key = (status: Key) => Key; //鍵への操作を表す関数の型.

const borrow_key: oper_key = (status: Key) => {
  return status === "RETURN" ? "BORROW" : status;
}; //鍵を借りることができるかどうかの判定.0なら成功で1を返し, 失敗なら引数の値をそのまま返す.
const open_key: oper_key = (status: Key) => {
  return (status === "BORROW" || status === "CLOSE") && !mode_console
    ? "OPEN"
    : status;
}; //鍵を開けることができるかどうかの判定.1か3なら成功で2を返し, 失敗なら引数の値をそのまま返す.操作卓モードだと失敗する.
const close_key: oper_key = (status: Key) => {
  return status === "OPEN" && !mode_console ? "CLOSE" : status;
}; //鍵を閉めることができるかどうかの判定.2なら成功で3を返し, 失敗なら引数の値をそのまま返す.操作卓モードだと失敗する.
const return_key: oper_key = (status: Key) => {
  return status === "BORROW" || status === "CLOSE" ? "RETURN" : status;
}; //鍵を返却することができるかどうかの判定.1か3なら成功で3を返し, 失敗なら引数の値をそのまま返す.

// リマインダーメッセージを送信する関数
const sendReminderMessage = async (
  userId: string,
  username: string,
  channelId: string
) => {
  if (!isReminderEnabled) {
    console.log("リマインダー機能がOFFのため、送信をスキップしました。");
    return;
  }
  
  if (!borrowerInfo) {
    console.log("借りた人の情報がないため、リマインダーを送信できません。");
    return;
  }

  // リマインダー送信回数をカウント
  borrowerInfo.reminderCount++;
  const count = borrowerInfo.reminderCount;
  
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000) //赤色
        .setTitle(`⌛️返却リマインダー (${count}回目)`)
        .setDescription(
          `<@${userId}> さん、鍵を借りてから${reminderTimeMinutes * count}分が経過しました。\n返却を忘れていませんか？`
        )
        .setTimestamp();

      await (channel as TextChannel).send({
        content: `<@${userId}>`,
        embeds: [embed],
      });

      console.log(`リマインダーを送信しました (${count}回目)`);

      // Slack通知も送る
      // if (isUseSlack) {
      //   messagingSlack(
      //     `${username}さんへ (${count}回目): 鍵を借りてから${reminderTimeMinutes * count}分が経過しました。返却をお願いします。`
      //   )(settings.Slack.WebhookUrl);
      // }

      // 次のリマインダーをスケジュール
      if (borrowerInfo && isReminderEnabled && var_status !== "RETURN") {
        const timerId = setTimeout(() => {
          sendReminderMessage(
            borrowerInfo!.userId,
            borrowerInfo!.username,
            borrowerInfo!.channelId
          );
        }, reminderTimeMinutes * 60 * 1000);

        borrowerInfo.timerId = timerId;
        console.log(`次のリマインダーを${reminderTimeMinutes}分後にスケジュールしました。`);
      }
    }
  } catch (error) {
    console.error("リマインダーメッセージの送信に失敗しました:", error);
  }
};

// タイマーをクリアする関数
const clearReminderTimer = () => {
  if (borrowerInfo?.timerId) {
    clearTimeout(borrowerInfo.timerId);
    borrowerInfo = null;
  }
};

// リマインダータイマーを再設定する関数
const rescheduleReminderTimer = () => {
  if (!borrowerInfo || !isReminderEnabled) {
    return;
  }

  // 既存のタイマーをクリア
  if (borrowerInfo.timerId) {
    clearTimeout(borrowerInfo.timerId);
  }

  // 借りてからの経過時間を計算
  const now = Date.now();
  const elapsedMinutes = (now - borrowerInfo.borrowedAt) / 1000 / 60;
  
  // 次のリマインダーまでの時間を計算
  const nextReminderAt = (borrowerInfo.reminderCount + 1) * reminderTimeMinutes;
  const remainingMinutes = nextReminderAt - elapsedMinutes;

  console.log(`経過時間: ${Math.floor(elapsedMinutes)}分, 次のリマインダーまで: ${Math.floor(remainingMinutes)}分 (${borrowerInfo.reminderCount + 1}回目)`);

  // まだ次のリマインダー時間に達していない場合は再スケジュール
  if (remainingMinutes > 0) {
    const timerId = setTimeout(() => {
      sendReminderMessage(
        borrowerInfo!.userId,
        borrowerInfo!.username,
        borrowerInfo!.channelId
      );
    }, remainingMinutes * 60 * 1000);

    borrowerInfo.timerId = timerId;
    console.log(`リマインダーを再スケジュールしました。${Math.floor(remainingMinutes)}分後に通知します。`);
  } else {
    // 既に時間が経過している場合は即座に送信
    console.log(`既にリマインダー時間を経過しているため、即座に通知します。`);
    sendReminderMessage(
      borrowerInfo.userId,
      borrowerInfo.username,
      borrowerInfo.channelId
    );
  }
};

// 20時に鍵が返却されていない場合のチェック関数
const check20OClock = async () => {
  if (!isScheduledCheckEnabled) {
    console.log("定時チェック機能がOFFのため、チェックをスキップしました。");
    return;
  }
  
  // 鍵がRETURN状態でない場合（借りられている場合）
  if (var_status !== "RETURN" && borrowerInfo) {
    try {
      const channel = await client.channels.fetch(borrowerInfo.channelId);
      if (channel && channel.isTextBased()) {
        const embed = new EmbedBuilder()
          .setColor(0xff0000) // 赤色
          .setTitle("⏰️鍵返却確認")
          .setDescription(
            `<@${borrowerInfo.userId}> さん、定時になりましたが鍵がまだ返却されていません。\nemail：jm-hcgakusei@stf.teu.ac.jp`
          )
          .setTimestamp();

        await (channel as TextChannel).send({
          content: `<@${borrowerInfo.userId}>`,
          embeds: [embed],
        });

        console.log(`定時チェック: ${borrowerInfo.username}に返却リマインダーを送信しました。`);

        // Slack通知も送る
        // if (isUseSlack) {
        //   messagingSlack(
        //     `【定時確認】${borrowerInfo.username}さんへ: 鍵がまだ返却されていません。返却をお願いします。`
        //   )(settings.Slack.WebhookUrl);
        // }
      }
    } catch (error) {
      console.error("定時チェックメッセージの送信に失敗しました:", error);
    }
  } else {
    console.log("定時チェック: 鍵は返却されています。");
  }
};

// 次の定時チェックまでの時間を計算する関数
const getMillisecondsUntil20OClock = (): number => {
  const now = new Date();
  const target = new Date();
  target.setHours(checkHour, checkMinute, 0, 0); // 設定された時刻に設定

  console.log(`現在時刻: ${now.toLocaleString('ja-JP')}`);
  console.log(`ターゲット時刻: ${target.toLocaleString('ja-JP')}`);
  console.log(`now.getTime(): ${now.getTime()}, target.getTime(): ${target.getTime()}`);

  // もし現在時刻が既に設定時刻を過ぎていたら、翌日の設定時刻に設定
  if (now.getTime() >= target.getTime()) {
    console.log(`${checkHour}時${checkMinute}分を過ぎているため、翌日の${checkHour}時${checkMinute}分に設定します`);
    target.setDate(target.getDate() + 1);
    console.log(`新しいターゲット時刻: ${target.toLocaleString('ja-JP')}`);
  }

  const diff = target.getTime() - now.getTime();
  console.log(`時間差（ミリ秒）: ${diff}, 分: ${Math.round(diff / 1000 / 60)}`);

  return diff;
};

// 20時チェックをスケジュールする関数
const schedule20OClockCheck = () => {
  // 既存のタイマーをクリア
  if (scheduledCheckTimerId) {
    clearTimeout(scheduledCheckTimerId);
    scheduledCheckTimerId = null;
  }

  const scheduleNext = () => {
    const msUntil20 = getMillisecondsUntil20OClock();
    
    console.log(`次の定時チェックまで: ${Math.round(msUntil20 / 1000 / 60)}分 (${checkHour}時${checkMinute}分)`);

    scheduledCheckTimerId = setTimeout(() => {
      check20OClock();
      // 次の日のチェックをスケジュール
      scheduleNext();
    }, msUntil20);
  };
  
  scheduleNext();
};

// ボタンを定義している
const borrow_button = new ButtonBuilder()
  .setCustomId("BORROW")
  .setLabel("借りる")
  .setStyle(ButtonStyle.Success);
const opne_button = new ButtonBuilder()
  .setCustomId("OPEN")
  .setLabel("開ける")
  .setStyle(ButtonStyle.Success);
const close_button = new ButtonBuilder()
  .setCustomId("CLOSE")
  .setLabel("閉める")
  .setStyle(ButtonStyle.Danger);
const return_button = new ButtonBuilder()
  .setCustomId("RETURN")
  .setLabel("返す")
  .setStyle(ButtonStyle.Danger);

//鍵の状態とラベルを対応付けている
const mapLabel: Map<Key, string> = new Map([
  ["RETURN", "返しました"],
  ["BORROW", "借りました"],
  ["OPEN", "開けました"],
  ["CLOSE", "閉めました"],
]);

//鍵の状態とボタンのセットを対応付けている
const mapButtons: Map<Key, ActionRowBuilder<ButtonBuilder>> = new Map([
  [
    "RETURN",
    new ActionRowBuilder<ButtonBuilder>().addComponents(borrow_button),
  ],
  [
    "BORROW",
    !mode_console
      ? new ActionRowBuilder<ButtonBuilder>()
          .addComponents(opne_button)
          .addComponents(return_button)
      : new ActionRowBuilder<ButtonBuilder>().addComponents(return_button),
  ],
  ["OPEN", new ActionRowBuilder<ButtonBuilder>().addComponents(close_button)],
  [
    "CLOSE",
    new ActionRowBuilder<ButtonBuilder>()
      .addComponents(return_button)
      .addComponents(opne_button),
  ],
]);

//鍵の状態とそれに対応する操作を紐づけている
const mapOpers: Map<Key, oper_key> = new Map([
  ["RETURN", return_key],
  ["BORROW", borrow_key],
  ["OPEN", open_key],
  ["CLOSE", close_key],
]);

//setPresenceの引数のオブジェクト内のActivityの型の定義
type Activity = {
  name: string;
};
//setPresenceの引数のオブジェクトの型の定義
type Presence = {
  status: PresenceStatusData;
  activities: Activity[];
};

//状態とPrecenceを紐づけている
const mapPresence: Map<Key, Presence> = new Map([
  [
    "RETURN",
    {
      status: "invisible",
      activities: [],
    },
  ],
  [
    "BORROW",
    {
      status: "idle",
      activities: [],
    },
  ],
  [
    "OPEN",
    {
      status: "online",
      activities: [{ name: "部室" }],
    },
  ],
  [
    "CLOSE",
    {
      status: "idle",
      activities: [],
    },
  ],
]);

//ボットが起動したら
client.once("ready", async (bot) => {
  console.log("Ready!");

  if (client.user) {
    console.log(client.user.tag);
  }
  client.user?.setPresence({
    status: "invisible",
    activities: [],
  }); //ステータスを非公開にする

  // スラッシュコマンドを登録
  const commands = [
    new SlashCommandBuilder()
      .setName("reminder")
      .setDescription("リマインダー機能のON/OFF")
      .addStringOption(option =>
        option.setName("status")
          .setDescription("ON または OFF")
          .setRequired(true)
          .addChoices(
            { name: "ON", value: "on" },
            { name: "OFF", value: "off" }
          )
      ),
    new SlashCommandBuilder()
      .setName("scheduled-check")
      .setDescription("定時チェック機能のON/OFF")
      .addStringOption(option =>
        option.setName("status")
          .setDescription("ON または OFF")
          .setRequired(true)
          .addChoices(
            { name: "ON", value: "on" },
            { name: "OFF", value: "off" }
          )
      ),
    new SlashCommandBuilder()
      .setName("set-reminder-time")
      .setDescription("リマインダー送信時間を設定（分）")
      .addIntegerOption(option =>
        option.setName("minutes")
          .setDescription("リマインダー送信までの時間（分）")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1440)
      ),
    new SlashCommandBuilder()
      .setName("set-check-time")
      .setDescription("定時チェックの時刻を設定")
      .addIntegerOption(option =>
        option.setName("hour")
          .setDescription("時（0-23）")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(23)
      )
      .addIntegerOption(option =>
        option.setName("minute")
          .setDescription("分（0-59）")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(59)
      ),
    new SlashCommandBuilder()
      .setName("alarm-status")
      .setDescription("現在のアラーム設定を表示"),
    new SlashCommandBuilder()
      .setName("change-owner")
      .setDescription("鍵の持ち主を変更")
      .addUserOption(option =>
        option.setName("user")
          .setDescription("新しい持ち主")
          .setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    console.log("スラッシュコマンドを登録しています...");
    await rest.put(
      Routes.applicationCommands(client.user!.id),
      { body: commands }
    );
    console.log("スラッシュコマンドの登録が完了しました。");
  } catch (error) {
    console.error("スラッシュコマンドの登録に失敗しました:", error);
  }

  // 16時チェックをスケジュール
  schedule20OClockCheck();

  //鍵用チャンネルに初期メッセージを送る
  if (id_log_channel) {
    const initialButtonSet: ActionRowBuilder<ButtonBuilder> =
      mapButtons.get("RETURN") ?? new ActionRowBuilder<ButtonBuilder>();
    (bot.channels?.cache.get(id_log_channel) as TextChannel).send({
      content: "鍵管理Botです. 鍵をに対する操作を選んでください.",
      components: [initialButtonSet],
    });
  } //discordにメッセージを送る
});
//型がKeyかどうかを確認するためのユーザー定義型ガード
const isKey = (value: string): value is Key => {
  return (
    value === "BORROW" ||
    value === "OPEN" ||
    value === "CLOSE" ||
    value === "RETURN"
  );
};

client.on(Events.InteractionCreate, async (interaction) => {
  // スラッシュコマンドの処理
  if (interaction.isChatInputCommand()) {
    const { commandName } = interaction;

    if (commandName === "reminder") {
      const status = interaction.options.getString("status");
      isReminderEnabled = status === "on";
      await interaction.reply({
        content: `リマインダー機能を${isReminderEnabled ? "ON" : "OFF"}にしました。`,
      });
      console.log(`リマインダー機能: ${isReminderEnabled ? "ON" : "OFF"}`);
      return;
    }

    if (commandName === "scheduled-check") {
      const status = interaction.options.getString("status");
      isScheduledCheckEnabled = status === "on";
      await interaction.reply({
        content: `定時チェック機能を${isScheduledCheckEnabled ? "ON" : "OFF"}にしました。`,
      });
      console.log(`定時チェック機能: ${isScheduledCheckEnabled ? "ON" : "OFF"}`);
      return;
    }

    if (commandName === "set-reminder-time") {
      const minutes = interaction.options.getInteger("minutes");
      if (minutes) {
        reminderTimeMinutes = minutes;
        
        // 鍵が借りられている場合、リマインダーを再スケジュール
        if (borrowerInfo && var_status !== "RETURN") {
          rescheduleReminderTimer();
          await interaction.reply({
            content: `リマインダー送信時間を${minutes}分に設定しました。`,
          });
        } else {
          await interaction.reply({
            content: `リマインダー間隔を${minutes}分に設定しました。`,
          });
        }

        console.log(`リマインダー間隔: ${minutes}分`);
      }
      return;
    }

    if (commandName === "set-check-time") {
      const hour = interaction.options.getInteger("hour");
      const minute = interaction.options.getInteger("minute");
      if (hour !== null && minute !== null) {
        checkHour = hour;
        checkMinute = minute;
        
        // スケジュールを即座に再設定
        schedule20OClockCheck();
        
        await interaction.reply({
          content: `定時チェック時刻を${hour}時${minute}分に設定しました。`,
        });
        console.log(`定時チェック時刻: ${hour}時${minute}分に変更し、スケジュールを再設定しました。`);
      }
      return;
    }

    if (commandName === "alarm-status") {
      const statusEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("⚙️ アラーム設定状況")
        .addFields(
          { name: "リマインダー機能", value: isReminderEnabled ? "✅ ON" : "❌ OFF", inline: true },
          { name: "定時チェック機能", value: isScheduledCheckEnabled ? "✅ ON" : "❌ OFF", inline: true },
          { name: "リマインダー時間", value: `${reminderTimeMinutes}分`, inline: true },
          { name: "定時チェック時刻", value: `${checkHour}時${checkMinute}分`, inline: true }
        )
        .setTimestamp();

      await interaction.reply({
        embeds: [statusEmbed],
      });
      return;
    }

    if (commandName === "change-owner") {
      // 鍵が借りられているかチェック
      if (var_status === "RETURN" || !borrowerInfo) {
        await interaction.reply({
          content: "❌ 現在、鍵は借りられていません。",
        });
        return;
      }

      const newOwner = interaction.options.getUser("user");
      if (!newOwner) {
        await interaction.reply({
          content: "❌ ユーザーが指定されていません。",
        });
        return;
      }

      const oldOwnerName = borrowerInfo.username;
      const oldOwnerId = borrowerInfo.userId; // 旧持ち主のIDを保存
      const newOwnerTag = newOwner.tag;
      const newOwnerName = newOwnerTag.split("#")[1] ? newOwner.username : newOwnerTag;

      // 旧持ち主のリマインダータイマーをクリア
      clearReminderTimer();

      // 新しい持ち主の情報を設定（リマインダーカウントをリセット）
      if (isReminderEnabled) {
        // 新しい持ち主用に新しいタイマーを設定（カウントリセット）
        const now = Date.now();
        const timerId = setTimeout(() => {
          sendReminderMessage(
            newOwner.id,
            newOwnerName,
            interaction.channelId!
          );
        }, reminderTimeMinutes * 60 * 1000); // 0からカウント開始

        borrowerInfo = {
          userId: newOwner.id,
          username: newOwnerName,
          channelId: interaction.channelId!,
          timerId: timerId,
          borrowedAt: now, // 持ち主変更時刻を記録
          reminderCount: 0, // カウントをリセット
        };

        console.log(
          `鍵の持ち主を ${oldOwnerName} から ${newOwnerName} に変更しました。リマインダーカウントをリセットし、${reminderTimeMinutes}分後に通知します。`
        );
      } else {
        borrowerInfo = {
          userId: newOwner.id,
          username: newOwnerName,
          channelId: interaction.channelId!,
          timerId: null,
          borrowedAt: Date.now(), // 持ち主変更時刻を記録
          reminderCount: 0, // カウントをリセット
        };
        
        console.log(
          `鍵の持ち主を ${oldOwnerName} から ${newOwnerName} に変更しました。リマインダー機能はOFFです。`
        );
      }

      const changeEmbed = new EmbedBuilder()
        .setColor(0xffa500) // オレンジ色
        .setTitle("🔄 鍵の持ち主変更")
        .setDescription(
          `鍵の持ち主を変更しました\n<@${oldOwnerId}> → <@${newOwner.id}>\n${isReminderEnabled ? `⏰ リマインダー: ${reminderTimeMinutes}分後に通知` : ""}`
        )
        .setTimestamp();

      await interaction.reply({
        embeds: [changeEmbed],
      });

      return;
    }
  }

  // ボタンの処理
  if (!interaction.isButton()) {
    return;
  } //インタラクションがボタンかどうかを確認する
  if (!isKey(var_status)) {
    throw Error("var_status is not apropriate");
  } //var_statusの型がKeyかどうかを確認する

  const btn = interaction.customId; //押されたボタンの状態(型:Key)を代入する
  if (!isKey(btn)) {
    throw Error("buttonInteraction.customId is not Key");
  } //customIdがKey型かどうかを確認する.

  const oper = mapOpers.get(btn); //押されたボタンに対応する操作を得る
  if (!oper) {
    throw Error("oper is undefined");
  }
  var_status = oper(var_status); //状態を更新する

  const buttonSet = mapButtons.get(var_status); //更新後の状態に対応するボタンセットを得る
  if (!buttonSet) {
    throw Error("buttonSet is undefined");
  }

  const label = mapLabel.get(var_status); //更新後の状態に対応するラベルを得る
  if (!label) {
    throw Error("label is undefined");
  }

  const presence = mapPresence.get(var_status); //更新後の状態に対応するPresenceを得る
  if (!presence) {
    throw Error("presence is undefined");
  }

  interaction.client.user.setPresence(presence); //Presenceを更新する

  const userTag = interaction.user.tag; // userTagを取得

  // userTagを#で分割して識別タグが0ならば，usernameを取得する
  const username = userTag.split("#")[1] ? interaction.user.username : userTag;

  const userIconUrl = interaction.user.avatarURL();

  const embed = new EmbedBuilder() //鍵になにかした時のメッセージを作る
    .setColor(0x0099ff) //水色っぽい色
    .setAuthor({ name: username, iconURL: userIconUrl ?? undefined }) //ボタンを押した人のユーザー名とアイコンを取得する
    .setTitle(`${label}`) //行った操作を表示する
    .setTimestamp();

  // 鍵を借りた時の場合は、リマインダー設定情報を追加
  if (btn === "BORROW" && var_status === "BORROW") {
    if (isReminderEnabled) {
      embed.addFields({
        name: "⏰ リマインダー設定",
        value: `リマインダーが有効です\n・間隔: ${reminderTimeMinutes}分ごと\n・定時チェック: ${checkHour}時${checkMinute}分`,
        inline: false
      });
    } else {
      embed.addFields({
        name: "⏰ リマインダー設定",
        value: `リマインダーは無効です\n・定時チェック: ${isScheduledCheckEnabled ? `${checkHour}時${checkMinute}分` : "無効"}`,
        inline: false
      });
    }
  }

  await interaction.reply({
    embeds: [embed],
    components: [buttonSet],
  });

  // 前回のメッセージを取得
  const previousMessage = await interaction.channel?.messages.fetch(
    interaction.message.id
  );

  // もし前回のメッセージがあれば，ボタンを無効化する
  if (previousMessage) {
    previousMessage.edit({
      embeds: previousMessage.embeds,
      components: [],
    });
  }

  // 鍵を借りた時の処理
  if (btn === "BORROW" && var_status === "BORROW") {
    // 既存のタイマーがあればクリア
    clearReminderTimer();

    // リマインダー機能がONの場合のみタイマーを設定
    if (isReminderEnabled) {
      // 借りたユーザー情報を保存
      const now = Date.now();
      const timerId = setTimeout(() => {
        sendReminderMessage(
          interaction.user.id,
          username,
          interaction.channelId
        );
      }, reminderTimeMinutes * 60 * 1000); // 分をミリ秒に変換

      borrowerInfo = {
        userId: interaction.user.id,
        username: username,
        channelId: interaction.channelId,
        timerId: timerId,
        borrowedAt: now, // 借りた時刻を記録
        reminderCount: 0, // カウントを初期化
      };

      console.log(
        `${username}が鍵を借りました。${reminderTimeMinutes}分後にリマインダーを送信します。`
      );
    } else {
      borrowerInfo = {
        userId: interaction.user.id,
        username: username,
        channelId: interaction.channelId,
        timerId: null,
        borrowedAt: Date.now(), // 借りた時刻を記録
        reminderCount: 0, // カウントを初期化
      };
      console.log(
        `${username}が鍵を借りました。リマインダー機能はOFFです。`
      );
    }
  }

  // 鍵を返した時の処理
  if (btn === "RETURN" && var_status === "RETURN") {
    // タイマーをクリア
    clearReminderTimer();
    console.log(`鍵が返却されました。リマインダータイマーをクリアしました。`);
  }

  // if (isUseSlack) {
  //   messagingSlack(createMessage(username)(label))(settings.Slack.WebhookUrl);
  // }
});
client.login(token);
