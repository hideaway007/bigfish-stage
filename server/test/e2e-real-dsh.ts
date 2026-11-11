import { startServer } from '../src/index';
import { WebSocket } from 'ws';

async function runRealDshTest() {
  console.log('正在启动 P5 Stage 服务 (端口 5388)...');
  const app = await startServer({ port: 5388 });
  console.log('✓ Stage 服务已就绪: http://127.0.0.1:5388');

  const wsUrl = `ws://127.0.0.1:5388/ws`;
  console.log(`正在通过 WebSocket 连接 ${wsUrl}...`);

  const ws = new WebSocket(wsUrl, {
    headers: { origin: 'http://127.0.0.1:5388' },
  });

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('测试超时 (30 秒)'));
    }, 30000);

    ws.on('open', () => {
      console.log('✓ WebSocket 握手成功，发送 hello...');
      ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1 }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'welcome') {
        console.log('\n[P5 舞台欢迎信息]');
        console.log('检测到的执行 Agent 列表:');
        for (const ad of msg.workerAdapters || []) {
          console.log(`  - [${ad.id}] ${ad.name} (可用状态: ${ad.available ? '可用' : '不可用: ' + ad.unavailableReason})`);
        }

        console.log('\n配置 Worker 适配器为 dsh，指向当前工作区...');
        ws.send(
          JSON.stringify({
            type: 'update_settings',
            patch: {
              projectDir: process.cwd(),
              worker: {
                adapter: 'dsh',
                model: 'deepseek-v4.1-flash',
                connection: 'agent-default',
              },
            },
          })
        );

        setTimeout(() => {
          console.log('\n向 DSH 底座发送真实提问：');
          const prompt = '请只回答这一句话：“大肥鱼已成功连接 DSH 舞台！”';
          console.log(`> 用户提问: ${prompt}`);
          ws.send(
            JSON.stringify({
              type: 'send',
              id: 'real-test-msg-01',
              text: prompt,
            })
          );
        }, 600);
      }

      if (msg.type === 'event') {
        const ev = msg.event;
        if (ev.type === 'thinking') {
          console.log('🎭 [P5 舞台状态] 角色进入思考中 (thinking)...');
        } else if (ev.type === 'worker_text') {
          console.log(`💬 [Agent 原始回复] ${ev.text}${ev.final ? ' (最终)' : ''}`);
        } else if (ev.type === 'character_line') {
          console.log(`🐟 [角色台词演出] (${ev.emotion}) [${ev.characterId}] ${ev.text}`);
        } else if (ev.type === 'tool_start') {
          console.log(`⚔️ [技能发动卡] ${ev.tool.toUpperCase()} ▶ ${ev.summary}`);
        } else if (ev.type === 'tool_end') {
          console.log(`✓ [技能结算] ${ev.summary || ''} (成功: ${ev.ok})`);
        } else if (ev.type === 'turn_done') {
          console.log(`🏁 [本轮任务结束] 耗时: ${ev.durationMs}ms, 状态: ${ev.ok ? '成功' : '失败'}`);
          clearTimeout(timer);
          ws.close();
          resolve();
        } else if (ev.type === 'error') {
          console.error(`❌ [错误事件] ${ev.message}`);
        }
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

runRealDshTest()
  .then(() => {
    console.log('\n🎉 真实端到端联调测试全部通过！');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ 测试失败:', err);
    process.exit(1);
  });
