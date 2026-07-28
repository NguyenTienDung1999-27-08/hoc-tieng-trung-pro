export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: "Chỉ nhận POST" });

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "Chưa cấu hình API Key" });

  try {
    const { audioBase64, targetWord, mimeType } = req.body;

    // Lệnh bí mật ép AI chấm điểm phát âm
    const prompt = `Bạn là giáo viên tiếng Trung. Trò đang cố gắng phát âm từ: "${targetWord}".
Hãy nghe đoạn ghi âm đính kèm và chấm điểm phát âm từ 0 đến 100.
Chỉ trả lời đúng 1 dòng theo mẫu:
[Điểm/100] - [Nhận xét rất ngắn gọn, chỉ ra lỗi sai thanh điệu hoặc vận mẫu nếu có]`;

    // Gọi AI (Dùng bản flash-lite để phản hồi nhanh nhất)
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`;    
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { 
              inlineData: {
                mimeType: mimeType || "audio/webm",
                data: audioBase64
              }
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Lỗi từ Google AI");

    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    res.status(200).json({ result: aiText || "Không có phản hồi từ AI" });

  } catch (error) {
    res.status(500).json({ error: "Lỗi nghe âm thanh: " + error.message });
  }
}