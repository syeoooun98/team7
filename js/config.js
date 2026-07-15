// Supabase 프로젝트 연결 설정
// - team7-wanted 프로젝트, anon(공개 읽기 전용) key만 사용한다.
// - service_role 등 비밀 키는 절대 여기에 넣지 않는다.
export const SUPABASE_URL = 'https://dyefquffbtagiypuwocw.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5ZWZxdWZmYnRhZ2l5cHV3b2N3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5OTg2MzMsImV4cCI6MjA5OTU3NDYzM30.lNzQM7qPMyPb8WtsX0PE6Q2mPrhJls2K5t1tm4SeILA';

// index.html에서 @supabase/supabase-js CDN 스크립트를 먼저 로드하므로
// 전역 window.supabase(빌더)에서 클라이언트 인스턴스를 생성한다.
if (!window.supabase) {
  throw new Error('supabase-js CDN 스크립트가 로드되지 않았습니다.');
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
