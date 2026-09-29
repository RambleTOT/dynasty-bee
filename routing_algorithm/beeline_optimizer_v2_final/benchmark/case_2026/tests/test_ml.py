import unittest, tempfile
import numpy as np
import pandas as pd
from dispatch.ml import QuantileDurationModel, chronological_split, service_matrix
from dispatch.demo import synthetic_instance

class TestML(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rng=np.random.default_rng(33); n=240
        cls.frame=pd.DataFrame({'date':pd.date_range('2025-01-01',periods=12).repeat(20),
            'planned_km':rng.uniform(.5,15,n),'mode':np.where(np.arange(n)%2,'car','bike')})
        cls.frame['duration_minutes']=5+cls.frame.planned_km*2+rng.lognormal(.5,.3,n)
        cls.train,cls.cal,cls.test=chronological_split(cls.frame,'date')
        cls.model=QuantileDurationModel(['planned_km','mode'],['mode'],iterations=25,origin='SYNTHETIC_UNIT_TEST').fit(cls.train,cls.cal)
    def test_whole_day_disjoint_chronological(self):
        self.assertLess(self.train.date.max(),self.cal.date.min());self.assertLess(self.cal.date.max(),self.test.date.min())
    def test_prediction_order_nonnegative(self):
        p=self.model.predict(self.test)
        self.assertTrue(np.all(p.median_minutes>=0));self.assertTrue(np.all(p.calibrated_upper_minutes>=p.median_minutes))
        self.assertEqual(len(p),len(self.test))
    def test_save_load(self):
        with tempfile.TemporaryDirectory() as d:
            self.model.save(d);loaded=QuantileDurationModel.load(d)
            np.testing.assert_allclose(self.model.predict(self.test),loaded.predict(self.test),rtol=1e-7)
    def test_target_leak_rejected(self):
        with self.assertRaises(ValueError):
            QuantileDurationModel(['duration_minutes'],[],iterations=1,origin='SYNTHETIC').fit(self.train,self.cal)
    def test_missing_origin_rejected(self):
        with self.assertRaises(ValueError):
            QuantileDurationModel(['planned_km'],[],iterations=1).fit(self.train,self.cal)
    def test_engineer_conditional_matrix(self):
        ins=synthetic_instance(3,2,42)
        rows=pd.DataFrame([dict(engineer_id=e.id,task_id=t.id,planned_km=1,mode='car') for e in ins.engineers for t in ins.tasks])
        mat=service_matrix(ins,rows,self.model)
        self.assertEqual(mat.shape,(2,3));self.assertTrue(np.all(mat>=0))
        with self.assertRaises(ValueError):service_matrix(ins,rows.iloc[1:],self.model)
    def test_metrics_finite(self):
        result=self.model.evaluate(self.test)
        self.assertTrue(np.isfinite(result['median_mae_minutes']));self.assertTrue(0<=result['upper_empirical_coverage']<=1)

if __name__=='__main__':unittest.main()
