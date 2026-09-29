import unittest
import numpy as np
from dispatch.model import Task, Engineer, Instance
from dispatch.evaluate import Evaluator

class TestRicherConstraints(unittest.TestCase):
    def make(self, task, engineer):
        m=np.array([[0,10],[10,0]],dtype=int)
        return Instance([task],[engineer],{'car':m},{'car':m*100})

    def test_skill_level_is_hard_constraint(self):
        t=Task('T',1,30,540,900,'fiber',min_skill_level=2)
        e=Engineer('E',0,540,1080,('fiber',),'car',skill_levels=(('fiber',1),))
        self.assertFalse(Evaluator(self.make(t,e)).a.allowed[0,0])
        e2=Engineer('E',0,540,1080,('fiber',),'car',skill_levels=(('fiber',3),))
        self.assertTrue(Evaluator(self.make(t,e2)).a.allowed[0,0])

    def test_tools_are_hard_constraint(self):
        t=Task('T',1,30,540,900,'fiber',required_tools=('otdr',))
        e=Engineer('E',0,540,1080,('fiber',),'car',tools=('ladder',))
        self.assertFalse(Evaluator(self.make(t,e)).a.allowed[0,0])
        e2=Engineer('E',0,540,1080,('fiber',),'car',tools=('ladder','otdr'))
        self.assertTrue(Evaluator(self.make(t,e2)).a.allowed[0,0])

if __name__ == '__main__': unittest.main()
