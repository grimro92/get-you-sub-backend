import json
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

def download_subtitles_to_json(video_id: str, languages: list[str] = ['en', 'ja'], output_dir: str = '.') -> dict:
    """
    指定されたYouTube動画IDから、指定された言語の字幕データを取得し、JSONファイルとして保存します。

    Args:
        video_id (str): 字幕を取得するYouTube動画のID。
        languages (list[str]): 取得したい字幕の言語コードのリスト (例: ['en', 'ja'] )。
        output_dir (str): 字幕ファイルを保存するディレクトリのパス。

    Returns:
        dict: 取得した字幕データを言語コードをキーとする辞書で返します。
              字幕が取得できなかった言語は辞書に含まれません。
    """
    all_subtitles = {}
    
    print(f"動画ID: {video_id} の字幕を取得中...")

    try:
        # 利用可能な全ての字幕リストを取得
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        print("利用可能な字幕トラック:")
        for t in transcript_list:
            print(f"- Language: {t.language_code} (Generated: {t.is_generated})")

        for lang_code in languages:
            try:
                # 指定された言語の字幕を取得
                # 指定言語がない場合は、自動生成字幕（もしあれば）を試す
                transcript = transcript_list.find_transcript([lang_code])
                
                # 字幕データをフェッチ
                # ここで取得されるのは FetchedTranscriptSnippet オブジェクトのリスト
                fetched_snippets = transcript.fetch()
                
                # JSONに変換可能な形式（辞書のリスト）に変換
                subtitles_for_json = []
                for snippet in fetched_snippets:
                    subtitles_for_json.append({
                        'text': snippet.text,
                        'start': snippet.start,
                        'duration': snippet.duration
                    })
                
                all_subtitles[lang_code] = subtitles_for_json # 変換したデータを格納
                
                # JSONファイルとして保存
                output_filepath = f"{output_dir}/{video_id}_{lang_code}.json"
                with open(output_filepath, 'w', encoding='utf-8') as f:
                    json.dump(subtitles_for_json, f, ensure_ascii=False, indent=2) # 変換したデータを保存
                print(f"  - {lang_code} 字幕を '{output_filepath}' に保存しました。")

            except NoTranscriptFound:
                print(f"  - {lang_code} 字幕が動画ID '{video_id}' で見つかりませんでした。")
            except Exception as e:
                print(f"  - {lang_code} 字幕の取得中にエラーが発生しました: {e}")

    except TranscriptsDisabled:
        print(f"動画ID '{video_id}' の字幕がオフに設定されています。")
    except Exception as e:
        print(f"動画情報または字幕リストの取得中にエラーが発生しました: {e}")
        
    return all_subtitles

if __name__ == "__main__":
    # 実際の動画IDに置き換えてください
    target_video_id = "UNqX4Aq64Dg" # 例としてUNqX4Aq64Dgを使用します
    
    # ダウンロードした字幕を保存するディレクトリ
    output_directory = "." 

    downloaded_data = download_subtitles_to_json(target_video_id, output_dir=output_directory)
    
    if downloaded_data:
        print("\n全てのダウンロード済み字幕データ:")
        for lang, data in downloaded_data.items():
            print(f"- {lang} 字幕 (最初の5件):")
            # ここも辞書形式でアクセスするように修正
            for i, entry in enumerate(data[:5]):
                # 'text'キーが存在するかチェックしてからアクセス
                text_preview = entry['text'][:50] + '...' if len(entry['text']) > 50 else entry['text']
                print(f"  Start: {entry['start']:.2f}s, Duration: {entry['duration']:.2f}s, Text: '{text_preview}'")
            if len(data) > 5:
                print(f"  ... (合計 {len(data)} 件)")
    else:
        print("\n字幕は何もダウンロードされませんでした。")