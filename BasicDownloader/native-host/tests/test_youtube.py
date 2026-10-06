import json, tempfile, unittest
from pathlib import Path
from stream_host.youtube import page_url,height_limit,format_selector,summarize,YoutubeProgress,YoutubeError,YoutubeEngine,engine_failure,cleanup_work
URL='https://www.youtube.com/watch?v=D2cUkF-MPJU'
class YoutubeTests(unittest.TestCase):
    def test_pages(self):
        self.assertEqual(page_url(URL+'&token=SECRET&list=x'),URL)
        self.assertEqual(page_url('https://youtu.be/D2cUkF-MPJU'),URL)
        self.assertEqual(page_url('https://youtube.com/shorts/D2cUkF-MPJU'),URL)
        for value in ['blob:'+URL,'https://youtube.com.evil.test/watch?v=D2cUkF-MPJU','https://u:p@youtube.com/watch?v=D2cUkF-MPJU','file:///test','https://youtube.com/playlist?list=x']:
            with self.assertRaises(ValueError):page_url(value)
    def test_options(self):
        self.assertIn('[height<=720]',format_selector(720,False,'mkv'))
        self.assertEqual(format_selector(None,True,'mp4'),'ba[ext=m4a]')
        for value in [True,0,999,[],{},'720']:
            with self.assertRaises(ValueError):height_limit(value)
    def info(self):
        video={'format_id':'398','vcodec':'av01','acodec':'none','height':720,'width':1280,'url':'https://secret.test/?token=SECRET','http_headers':{'Cookie':'PRIVATE'}}
        audio={'format_id':'251-2','vcodec':'none','acodec':'opus'}
        return {'id':'D2cUkF-MPJU','title':'Example','duration':671,'requested_formats':[video,audio],'formats':[video,audio]}
    def test_metadata_is_safe_and_has_selected_av(self):
        result=summarize(self.info(),URL)
        self.assertEqual(len(result['videoStreams']),1);self.assertEqual(len(result['audioStreams']),1)
        self.assertEqual(result['heights'],[720]);self.assertEqual(result['duration'],671)
        text=json.dumps(result);self.assertNotIn('SECRET',text);self.assertNotIn('Cookie',text);self.assertNotIn('PRIVATE',text)
    def test_wrong_video_drm_live_and_silent_are_rejected(self):
        for change in ['id','drm','live','silent']:
            info=self.info()
            if change=='id':info['id']='different'
            if change=='drm':info['requested_formats'][0]['has_drm']=True
            if change=='live':info['is_live']=True
            if change=='silent':info['requested_formats']=info['requested_formats'][:1]
            with self.assertRaises(YoutubeError):summarize(info,URL)
    def test_progress_never_completes_after_first_track(self):
        p=YoutubeProgress(['398','251-2'])
        def feed(id,done,total):return p.feed('PSD_PROGRESS:'+json.dumps({'formatId':id,'downloaded':done,'total':total,'speed':100,'eta':2}))
        first=feed('398',100,100);self.assertEqual(first['percent'],49)
        second=feed('251-2',50,100);self.assertEqual(second['percent'],73.5)
        self.assertEqual(feed('251-2',100,100)['percent'],98)
        self.assertIsNone(p.feed('[download] raw log with private URL'))
        self.assertIsNone(p.feed('PSD_PROGRESS:not json'))
    def test_error_messages_do_not_echo_secrets(self):
        e=engine_failure('ERROR 403 https://x.test/?token=SECRET Cookie: PRIVATE')
        self.assertEqual(e.code,'youtube_auth_required');self.assertNotIn('SECRET',str(e));self.assertNotIn('PRIVATE',str(e))
    def test_progress_template_uses_json_null_for_missing_values(self):
        engine=YoutubeEngine.__new__(YoutubeEngine);engine.path=Path('yt-dlp.exe');engine.runtime=Path('node.exe')
        command=engine.command(URL,Path('work'),Path('ffmpeg.exe'),720,False,'mkv')
        self.assertEqual(command[command.index('--output-na-placeholder')+1],'null')
        self.assertIn('--ignore-config',command);self.assertIn('--no-plugin-dirs',command)
        self.assertNotIn('--cookies',command);self.assertNotIn('--cookies-from-browser',command)
        p=YoutubeProgress(['398','251-2'])
        # Real yt-dlp output with missing ETA/speed/estimate must parse, not be dropped.
        line='PSD_PROGRESS:{"downloaded":1024,"total":6678311,"estimated":null,"eta":null,"speed":null,"formatId":"398"}'
        self.assertGreater(p.feed(line)['percent'],0)
    def test_temp_cleanup_boundary_and_policy(self):
        ident='11111111-1111-1111-1111-111111111111'
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);work=root/('.youtube-'+ident);work.mkdir();(work/'media.part').write_bytes(b'x')
            cleanup_work(work,root,ident,True);self.assertTrue(work.exists())
            cleanup_work(work,root,ident,False);self.assertFalse(work.exists())
            wrong=root/'wrong';wrong.mkdir()
            with self.assertRaises(ValueError):cleanup_work(wrong,root,ident,False)
if __name__=='__main__':unittest.main()
