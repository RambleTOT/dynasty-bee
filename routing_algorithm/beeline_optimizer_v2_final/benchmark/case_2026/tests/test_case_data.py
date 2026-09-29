import unittest,zipfile,io,tempfile
from pathlib import Path
from dispatch.case_data import read_archive,audit_archive

class TestCaseData(unittest.TestCase):
    def test_footer_and_blank_lines_are_not_jobs(self):
        text='Заявка;Тип заявки BK;Тип заявки HD;Начало;Окончание;Адрес\n1;Подключение;x;17.08.2026 10:00;17.08.2026 12:00;Адрес заявки\n;;;;;\n;;;;;\nАдрес офиса;Адрес старта;;;;\n'
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'case.zip'
            with zipfile.ZipFile(path,'w') as z:z.writestr('test.csv',text.encode('cp1251'))
            data=read_archive(path)['test.csv']
            self.assertEqual(len(data['rows']),1);self.assertEqual(data['office_addresses'],['Адрес старта'])
            self.assertEqual(audit_archive(path)['files'][0]['rows'],1)
    def test_nested_archive(self):
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w') as z:z.writestr('test.csv','Заявка;Тип заявки BK\n1;Работа\n'.encode('cp1251'))
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'outer.zip'
            with zipfile.ZipFile(path,'w') as z:z.writestr('inner.zip',b.getvalue())
            self.assertEqual(read_archive(path)['test.csv']['rows'][0]['Заявка'],'1')

if __name__=='__main__':unittest.main()
