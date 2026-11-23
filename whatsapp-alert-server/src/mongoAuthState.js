// Baileys session ko MongoDB me save karta hai.
// Render restart / sleep ke baad QR dobara scan nahi karna padega.
import { initAuthCreds, BufferJSON, proto } from 'baileys';

export async function useMongoAuthState(collection) {
  const writeData = (data, id) =>
    collection.replaceOne(
      { _id: id },
      { _id: id, value: JSON.stringify(data, BufferJSON.replacer) },
      { upsert: true }
    );

  const readData = async (id) => {
    const doc = await collection.findOne({ _id: id });
    return doc ? JSON.parse(doc.value, BufferJSON.reviver) : null;
  };

  const removeData = (id) => collection.deleteOne({ _id: id });

  const creds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => writeData(creds, 'creds'),
    clear: () => collection.deleteMany({}),
  };
}
