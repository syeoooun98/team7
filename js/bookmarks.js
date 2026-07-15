// 북마크(bookmarked_positions) 데이터 접근 레이어.
// 모든 DB 접근은 반드시 Supabase JS 클라이언트를 통해서만 수행한다.
import { supabase } from './config.js';

/**
 * 현재 로그인한 사용자의 applicant_profiles.id를 반환한다.
 * - 로그인되어 있지 않으면 null
 * - 로그인은 되어 있지만 지원자 프로필이 없으면(채용자 계정 등) null
 */
export async function getCurrentApplicantProfileId() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    console.error('[bookmarks] getSession 실패', sessionError);
    return null;
  }
  const session = sessionData?.session;
  if (!session || !session.user) return null;

  const { data, error } = await supabase
    .from('applicant_profiles')
    .select('id')
    .eq('user_id', session.user.id)
    .maybeSingle();
  if (error) {
    console.error('[bookmarks] applicant_profiles 조회 실패', error);
    return null;
  }
  return data ? data.id : null;
}

/** 해당 지원자 프로필이 북마크한 position_id 전체를 Set으로 반환한다. */
export async function fetchBookmarkedPositionIds(applicantProfileId) {
  if (!applicantProfileId) return new Set();

  const { data, error } = await supabase
    .from('bookmarked_positions')
    .select('position_id')
    .eq('applicant_profile_id', applicantProfileId);

  if (error) {
    console.error('[bookmarks] fetchBookmarkedPositionIds 실패', error);
    throw new Error('북마크 목록을 불러오지 못했습니다.');
  }
  return new Set((data || []).map((row) => row.position_id));
}

/**
 * 특정 지원자의 bookmarked_positions 변경(INSERT/DELETE)을 실시간으로 구독한다.
 * - onChange(payload)는 Supabase Realtime의 postgres_changes payload를 그대로 전달받는다
 *   (payload.eventType === 'INSERT' | 'DELETE' | 'UPDATE', payload.new / payload.old에 position_id 포함).
 * - applicantProfileId가 없으면(비로그인 등) 구독하지 않고 아무 것도 하지 않는 해제 함수를 반환한다.
 * - 반환값(구독 해제 함수)을 반드시 호출해 채널을 정리해야 한다(로그아웃/재구독 시 메모리 누수 방지).
 */
export function subscribeBookmarkChanges(applicantProfileId, onChange) {
  if (!applicantProfileId) return () => {};

  const channel = supabase
    .channel(`bookmark-changes-${applicantProfileId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bookmarked_positions',
        filter: `applicant_profile_id=eq.${applicantProfileId}`,
      },
      (payload) => onChange(payload)
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * 북마크 토글. 안 되어있으면 insert, 되어있으면 delete.
 * 반환값: 토글 후 최종 북마크 상태(bool)
 */
export async function toggleBookmark(applicantProfileId, positionId, currentlyBookmarked) {
  if (!applicantProfileId || !positionId) {
    throw new Error('잘못된 요청입니다.');
  }

  if (currentlyBookmarked) {
    const { error } = await supabase
      .from('bookmarked_positions')
      .delete()
      .eq('applicant_profile_id', applicantProfileId)
      .eq('position_id', positionId);
    if (error) {
      console.error('[bookmarks] 북마크 해제 실패', error);
      throw new Error('북마크 해제에 실패했습니다.');
    }
    return false;
  }

  const { error } = await supabase
    .from('bookmarked_positions')
    .insert({ applicant_profile_id: applicantProfileId, position_id: positionId });
  if (error) {
    console.error('[bookmarks] 북마크 저장 실패', error);
    throw new Error('북마크 저장에 실패했습니다.');
  }
  return true;
}
