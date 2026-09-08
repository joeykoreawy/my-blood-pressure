MyPressure V1.0
===============

배포
1) 이 폴더 안의 파일을 GitHub 저장소 my-blood-pressure의 루트에 업로드/교체합니다.
2) index.html, app.js, styles.css, manifest.json, sw.js, icon-192.png, icon-512.png가 저장소 첫 화면에 바로 보여야 합니다.
3) GitHub Pages 주소는 기존과 동일하게 유지합니다.
4) 아이폰 홈 화면 앱을 완전히 종료 후 다시 열어 업데이트를 확인합니다.

Supabase
- Project URL과 Publishable key는 app.js에 연결되어 있습니다.
- Secret key / service_role key는 절대 프론트엔드 파일에 넣지 않습니다.
- bp_measurements, user_settings 테이블 및 RLS 정책이 먼저 생성되어 있어야 합니다.

기존 V1 데이터
- 같은 GitHub Pages 주소에서 업데이트하면 기존 IndexedDB를 유지합니다.
- 로그인 후 기존 로컬 기록이 발견되면 현재 계정으로 가져올지 확인합니다.
- 확인하면 기록에 사용자 소유권을 붙인 뒤 서버에 동기화합니다.

V1.0 주요 기능
- 상황별 해시태그 복수 선택 및 사용자 태그
- 태그 조합별 통계
- 약 복용 전/후 평균 비교
- 복약 시작일 이후 통계
- 오늘 3회 측정 루틴
- 이메일 회원가입/로그인
- 로컬 우선 저장 + Supabase 동기화
- JSON/CSV 내보내기 및 기존 JSON 복원
