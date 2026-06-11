# secuday — 정보보호의 날 자료 관리

매월 1일 **정보보호의 날**에 임직원에게 배포하는 보안 인식 자료(포스터·안내 내용·임직원 수칙)를
버전 관리하며 운영하는 웹 프로그램입니다. `secuday.jbax.co.kr` 서브도메인 배포를 전제로 합니다.

## 주요 기능

- **월별 자료 관리** — 포스터 파일(이미지/PDF), 안내 내용(마크다운), 임직원 수칙 목록
- **버전 관리** — 모든 수정은 새 버전으로 기록 (수동 수정 / AI 수정 / 롤백 구분)
  - 버전 이력 조회, 두 버전 간 diff 비교, 이전 버전으로 복원
- **AI 질의** — 자료에 대해 질문하거나 수정을 요청하면 Claude(`claude-opus-4-8`)가
  수정안을 제안하고, 검토 후 새 버전으로 적용

## 실행 (개발)

```sh
python3 -m pip install --user flask anthropic
export ANTHROPIC_API_KEY=sk-ant-...   # AI 질의 기능에 필요
python3 seed.py                        # 최초 1회: 샘플 데이터 생성
python3 app.py                         # http://127.0.0.1:5234
```

- 포트 변경: `PORT=8000 python3 app.py`
- 데이터: `data/secuday.db` (SQLite), 포스터 파일: `uploads/`

## 구조

```
app.py            Flask 라우팅 (자료/버전/AI API + 정적 파일)
db.py             SQLite 스키마·쿼리 (materials / versions / ai_logs)
ai.py             Claude API 연동 (structured output으로 수정안 생성)
seed.py           샘플 데이터 시드
static/           프런트엔드 (index.html / app.js / style.css)
uploads/          업로드된 포스터 파일
data/secuday.db   SQLite DB
```

## API 요약

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/materials` | 자료 목록 |
| POST | `/api/materials` | 자료 등록 (multipart, v1 생성) |
| GET/PUT/DELETE | `/api/materials/:id` | 조회 / 수정(새 버전 생성) / 삭제 |
| GET | `/api/materials/:id/versions` | 버전 이력 |
| GET | `/api/materials/:id/versions/:vno` | 특정 버전 |
| POST | `/api/materials/:id/rollback/:vno` | 해당 버전으로 복원 (새 버전 생성) |
| GET | `/api/materials/:id/diff?from=1&to=2` | 버전 간 diff |
| POST | `/api/materials/:id/ai` | AI 질의 `{message}` → `{reply, proposal}` |
| POST | `/api/materials/:id/ai/apply` | AI 수정안을 새 버전으로 적용 |
| GET | `/api/materials/:id/ai/history` | AI 대화 이력 |

## secuday.jbax.co.kr 배포 가이드

서버(리눅스) 1대 기준 예시입니다.

### 1. DNS

jbax.co.kr DNS 관리 콘솔에서 서브도메인 레코드 추가:

```
secuday.jbax.co.kr.  A      <서버 공인 IP>
# 또는 기존 웹서버를 가리키면: CNAME  www.jbax.co.kr.
```

### 2. 앱 실행 (gunicorn + systemd)

```sh
pip install flask anthropic gunicorn
```

`/etc/systemd/system/secuday.service`:

```ini
[Unit]
Description=secuday (jeongboboho day material manager)
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/secuday
Environment=ANTHROPIC_API_KEY=sk-ant-...
ExecStart=/usr/local/bin/gunicorn -w 2 -b 127.0.0.1:5234 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now secuday
```

### 3. nginx 리버스 프록시 + HTTPS

`/etc/nginx/sites-available/secuday`:

```nginx
server {
    server_name secuday.jbax.co.kr;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:5234;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```sh
sudo ln -s /etc/nginx/sites-available/secuday /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d secuday.jbax.co.kr   # HTTPS 발급
```

### 4. 접근 제어 (권장)

사내용 도구이므로 다음 중 하나를 적용하세요.

- 사내망/VPN에서만 접근 가능하도록 방화벽 제한
- nginx `auth_basic` 또는 SSO(리버스 프록시 인증) 적용

## 백업

`data/secuday.db`와 `uploads/` 디렉터리만 백업하면 전체 이력이 보존됩니다.
