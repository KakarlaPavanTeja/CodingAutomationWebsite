#include <bits/stdc++.h>
using namespace std;

class solution{
public:
    vector<int> locatePairPositions(vector<int>& values,int required){
        unordered_map<int,int> seen;
        for(int i=0;i<(int)values.size();i++){
            int num=values[i];
            int complement=required-num;
            if(seen.find(complement)!=seen.end()){
                return {seen[complement],i};
            }
            seen[num]=i;
        }
        return {};
    }
};