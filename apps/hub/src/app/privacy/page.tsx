export default function PrivacyPage() {
  return (
    <main className="container">
      <h1>개인정보 및 광고 안내</h1>
      <p>
        현재 MVP 단계에서는 광고 스크립트를 포함하지 않았으며, 사용자 식별을 위한
        별도 서버 저장소를 운영하지 않습니다.
      </p>
      <p>
        점수는 브라우저 localStorage에 로컬로만 저장됩니다. 키 형식:
        <code>mg:best:&lt;slug&gt;</code>
      </p>
    </main>
  );
}
