import 'dotenv/config'; // .envファイルを読み込む
import express, { Request, Response } from 'express';
import { Pool, PoolClient } from 'pg';
import cors from 'cors';
import { spawn } from 'child_process'; // child_processモジュールをインポート

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({
    origin: ['http://localhost:5173', 'http://192.168.10.8:5173'], // ここにフロントエンドのURLを正確に設定してください
    methods: ['GET', 'POST'], // POSTメソッドを許可
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// PostgreSQL接続プールの設定
if (!process.env.DATABASE_URL) {
    console.error("エラー: DATABASE_URL 環境変数が設定されていません。");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // 自宅サーバーのPostgreSQLではSSL設定が不要な場合が多いですが、
    // もしSSL/TLSを有効にしている場合は適切に設定してください
    // ssl: { rejectUnauthorized: false }
});

// DB接続テスト
pool.connect()
    .then(client => {
        console.log('PostgreSQLに接続成功！');
        client.release();
    })
    .catch(err => {
        console.error('PostgreSQL接続エラー:', err.stack);
        process.exit(1);
    });

// 字幕データ保存用のテーブル作成関数
// async function createSubtitlesTable() {
//     try {
//         await pool.query(`
//             CREATE TABLE IF NOT EXISTS subtitles (
//                 id SERIAL PRIMARY KEY,
//                 video_id VARCHAR(255) NOT NULL,
//                 lang VARCHAR(10) NOT NULL,
//                 start_time_ms BIGINT NOT NULL, -- ミリ秒対応のためBIGINT
//                 duration_ms BIGINT NOT NULL, -- ミリ秒対応のためBIGINT
//                 text TEXT NOT NULL,
//                 UNIQUE(video_id, lang, start_time_ms)
//             );
//         `);
//         console.log('Subtitles table ensured.');
//     } catch (err) {
//         console.error('Error creating subtitles table:', err);
//     }
// }
// createSubtitlesTable(); // サーバー起動時にテーブル作成を試みる

// 字幕ダウンロードAPIエンドポイント
app.post('/download-subtitles', (req: Request, res: Response) => {
    (async () => {
        const { youtubeUrl } = req.body;

        if (!youtubeUrl) {
            return res.status(400).json({ error: 'YouTube URL is required.' });
        }

        // YouTube URLから動画IDを抽出
        // より堅牢な正規表現を使用
        const videoIdMatch = youtubeUrl.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
        const videoId = videoIdMatch ? videoIdMatch[1] : null;

        if (!videoId) {
            return res.status(400).json({ error: 'Invalid YouTube URL provided.', details: '動画IDを抽出できませんでした。URLが正しいか確認してください。' });
        }

        console.log(`Processing video ID: ${videoId}`);

        // Pythonスクリプトと実行ファイルのパスを正しく設定
        const pythonScriptPath = 'c:/GrimroProject/server/python/get_subtitles.py'; // あなたのPythonスクリプトのパス
        const pythonExecutable = 'C:/Users/ta09a/AppData/Local/Programs/Python/Python313/python.exe'; // あなたのPython実行ファイルのパス

        const pythonProcess = spawn(pythonExecutable, [pythonScriptPath, videoId]);

        let pythonOutput = '';
        let pythonError = '';

        pythonProcess.stdout.on('data', (data) => {
            pythonOutput += data.toString();
        });

        pythonProcess.stderr.on('data', (data) => {
            pythonError += data.toString();
        });

        pythonProcess.on('close', async (code) => {
            if (code === 0) { // Pythonスクリプトが正常終了した場合
                try {
                    const subtitles = JSON.parse(pythonOutput); // PythonからのJSON出力をパース

                    if (Object.keys(subtitles).length === 0) {
                        console.log(`No subtitles found for video ID: ${videoId}`);
                        return res.status(200).json({ 
                            message: '指定された言語の字幕が見つかりませんでした。', 
                            videoId: videoId,
                            subtitles: {} // 空の字幕データを返す
                        });
                    }

                    // PostgreSQLに字幕データを保存
                    const client = await pool.connect();
                    try {
                        for (const lang in subtitles) {
                            for (const segment of subtitles[lang]) {
                                // startとdurationは秒単位なので、ミリ秒に変換して保存
                                await client.query(
                                    `INSERT INTO subtitles (video_id, lang, start_time_ms, duration_ms, text)
                                     VALUES ($1, $2, $3, $4, $5)
                                     ON CONFLICT (video_id, lang, start_time_ms) DO NOTHING;`, // 重複挿入を避ける
                                    [videoId, lang, Math.round(segment.start * 1000), Math.round(segment.duration * 1000), segment.text]
                                );
                            }
                        }
                        res.status(200).json({ 
                            message: '字幕のダウンロードと保存が完了しました！', 
                            videoId: videoId, 
                            subtitles: subtitles // 成功した字幕データを返す
                        });
                    } finally {
                        client.release();
                    }

                } catch (jsonErr) {
                    console.error('Failed to parse Python output as JSON or DB insert error:', jsonErr);
                    console.error('Python Output:', pythonOutput); // デバッグ用に生のPython出力をログに出す
                    console.error('Python Error:', pythonError); // デバッグ用にPythonエラー出力をログに出す
                    res.status(500).json({ error: '字幕データの処理または保存に失敗しました。', details: pythonError || (jsonErr as Error).message });
                }
            } else { // Pythonスクリプトがエラー終了した場合
                console.error(`Python script exited with code ${code}`);
                console.error('Python Error Output:', pythonError);
                res.status(500).json({ error: '字幕のダウンロードに失敗しました。', details: pythonError || '不明なエラー' });
            }
        });

        pythonProcess.on('error', (err) => {
            console.error('Failed to spawn Python script process:', err);
            res.status(500).json({ error: '字幕処理プロセスを開始できませんでした。', details: err.message });
        });
    })();
});

// バックエンドサーバー起動
app.listen(port, '0.0.0.0', () => { // '0.0.0.0' を追加
    console.log(`バックエンドサーバーが http://localhost:${port} で起動しました`);
});