import { BOOT_URL, ENGINE_URL } from './program';
export async function fetchEngineSource(signal: AbortSignal) {
  const bootResponse = await fetch(BOOT_URL, { cache: 'no-cache', signal, credentials: 'omit' });
  if (!bootResponse.ok) throw new Error(`游戏版本读取失败：HTTP ${bootResponse.status}`);
  const boot = await bootResponse.text();
  const url = boot.match(/https:\/\/pokecatch-online\.pages\.dev\/bundle\/app\.[a-f0-9]+\.js/)?.[0];
  if (url !== ENGINE_URL) throw new Error('线上游戏版本已经变化；请更新助手适配后再模拟，已拒绝使用过期引擎');
  const response = await fetch(ENGINE_URL, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`游戏引擎读取失败：HTTP ${response.status}`);
  return response.text();
}
