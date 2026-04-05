import java.util.*;
import java.io.*;
class Solution{
    public List<Integer> two_sum(int[] nums,int target){
        HashMap<Integer,Integer> seen=new HashMap<>();
        for(int i=0;i<nums.length;i++){
            int num=nums[i];
            int complement=target-num;
            if(seen.containsKey(complement)){
                List<Integer> res=new ArrayList<>();
                res.add(seen.get(complement));
                res.add(i);
                return res;
            }
            seen.put(num,i);
        }
        return new ArrayList<>();
    }
}
public class Main{
    static class FastReader{
        private final InputStream in;
        private final byte[] buffer=new byte[1<<16];
        private int ptr=0,len=0;
        FastReader(){
            in=System.in;
        }
        private int read() throws IOException{
            if(ptr>=len){
                len=in.read(buffer);
                ptr=0;
                if(len<=0) return -1;
            }
            return buffer[ptr++];
        }
        int nextInt() throws IOException{
            int c;
            do{
                c=read();
            }while(c<=32&&c!=-1);
            int sign=1;
            if(c=='-'){
                sign=-1;
                c=read();
            }
            int val=0;
            while(c>32&&c!=-1){
                val=val*10+(c-'0');
                c=read();
            }
            return val*sign;
        }
    }
    public static void main(String[] args) throws Exception{
        FastReader fr=new FastReader();
        int n=fr.nextInt();
        int[] nums=new int[n];
        for(int i=0;i<n;i++) nums[i]=fr.nextInt();
        int target=fr.nextInt();
        Solution sol=new Solution();
        List<Integer> result=sol.two_sum(nums,target);
        if(!result.isEmpty()){
            System.out.println(result.get(0)+" "+result.get(1));
        }else{
            System.out.println(-1);
        }
    }
}