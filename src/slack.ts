import axios from "axios";

export const messagingSlack = (message: string) => {
  const messageData = { text: message };
  return async (url: string) => {
    await axios
      .post(url, JSON.stringify(messageData))
      .then((res) => {
        return res;
      })
      .catch((e) => {
        return e;
      });
  };
};

export const createMessage = (who: string) => {
  return (what: string) => {
    return `${who}が鍵を${what}`;
  };
};
